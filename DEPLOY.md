# Deploying to a new ESXi VM

A dedicated VM, built from nothing. The other stack stays on its own machine and
is never touched.

Because this is a separate VM, the port and volume collisions that would matter
on a shared host do not apply — 3000, 3306 and every volume name are yours
alone. The compose file still namespaces everything under `book-portal` and
defaults to host port 3100; set `HOST_PORT=3000` in `.env` if you prefer the
plain port on a machine that has nothing else on it.

---

## Part 1 — The VM

**Specification.** 2 vCPU, 4 GB RAM, 40 GB thin-provisioned disk. Ubuntu Server
24.04 LTS, minimal install, OpenSSH enabled.

4 GB is the number that matters. `next build` peaks around 2 GB, and on a 2 GB
VM the OOM reaper kills it partway through — which appears as a build that stops
with no error message at all, the most confusing failure in this whole document.
The bootstrap script adds swap if it finds less than 4 GB, but RAM is better.

**Give it a fixed address.** DHCP is fine until the lease moves and `AUTH_URL`,
the Google redirect URI and the tunnel all point at the wrong host. Either
reserve the address on your router or set it in netplan:

```bash
sudo nano /etc/netplan/50-cloud-init.yaml
```

```yaml
network:
  version: 2
  ethernets:
    ens160:
      dhcp4: no
      addresses: [192.168.6.190/24]
      routes:
        - to: default
          via: 192.168.6.1
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
```

```bash
sudo netplan apply
```

Check the interface name with `ip a` first — it is `ens160` on ESXi's VMXNET3
adapter, but `ens192` and others turn up depending on the adapter type.

**Install open-vm-tools** so ESXi can see the guest's IP and shut it down
cleanly:

```bash
sudo apt-get install -y open-vm-tools
```

---

## Part 2 — Prepare the machine

```bash
curl -fsSL -o bootstrap.sh \
  https://raw.githubusercontent.com/YOUR-USERNAME/book-portal/main/scripts/server-bootstrap.sh
bash bootstrap.sh
```

Or copy `scripts/server-bootstrap.sh` across by hand if the repo is still
private and not yet pushed.

It installs Docker Engine and the compose plugin from Docker's own repository,
adds swap if the VM is small, creates `/opt/book-portal`, and generates an SSH
key. Then **log out and back in** — the docker group change only applies to a
new login.

Why Docker's repository rather than `apt install docker.io`: Ubuntu's package
ships no compose plugin, so `docker compose` simply does not exist. The snap
build is confined and cannot bind-mount from `/opt`.

Verify:

```bash
docker compose version
```

---

## Part 3 — Connect this VM to GitHub

Your other VM's key stays where it is. This one needs its own — an SSH key
belongs to a machine, and GitHub rejects a public key that is already registered
anywhere on the platform, so copying the old one across does not work even if
you wanted to.

Two ways to register it. **A deploy key is the better choice for a server:**
it grants access to one repository instead of everything your account can
reach, so a compromised VM cannot touch your other work.

The bootstrap script printed the public key. If you need it again:

```bash
cat ~/.ssh/id_ed25519.pub
```

**As a deploy key (recommended).** On GitHub: the repository → Settings → Deploy
keys → Add deploy key. Paste it, give it a title, leave "Allow write access"
unchecked — the server only ever pulls.

**As an account key.** Settings → SSH and GPG keys → New SSH key. Simpler if you
expect to host several projects on this VM, since one key then covers them all.

Test it:

```bash
ssh -T git@github.com
```

A deploy key answers with the repository name rather than your username. Either
response means it worked.

---

## Part 4 — Push the code

From Windows, in `D:\rua-book-portal`. Skip this if the repo already exists.

```powershell
ssh -T git@github.com
```

If that fails, your Windows machine has no key either — `ssh-keygen -t ed25519`,
then add `~/.ssh/id_ed25519.pub` to GitHub as an account key.

Confirm nothing secret is staged before the first commit:

```powershell
git init
git add -A
git status --short | Select-String "\.env"
```

That must print nothing. `.env` holds the Google client secret, the Gemini key
and the database password.

```powershell
git commit -m "Book portal"
git branch -M main
git remote add origin git@github.com:YOUR-USERNAME/book-portal.git
git push -u origin main
```

---

## Part 5 — Deploy

```bash
git clone git@github.com:YOUR-USERNAME/book-portal.git /opt/book-portal
cd /opt/book-portal
cp .env.example .env
nano .env
```

Fill in:

```
MYSQL_ROOT_PASSWORD=<a new password>
MYSQL_DATABASE=bookportal
MYSQL_USER=portal
MYSQL_PASSWORD=<a new password>
DATABASE_URL=mysql://portal:<same password>@mysql:3306/bookportal

AUTH_SECRET=<paste from: openssl rand -base64 32>
AUTH_URL=http://192.168.6.190:3100
AUTH_TRUST_HOST=true
HOST_PORT=3100

AUTH_GOOGLE_ID=<from Google Cloud>
AUTH_GOOGLE_SECRET=<from Google Cloud>
GEMINI_API_KEY=<from AI Studio>
GEMINI_MODEL=gemini-2.5-flash

ALLOWED_EMAIL_DOMAINS=rua.edu.kh
BOOTSTRAP_UPLOADER_EMAILS=<your email>
SEED_ADMIN_EMAIL=<your email>

MAX_UPLOAD_MB=50
BLOCK_DOWNLOADS=false
```

Three things people get wrong here. `DATABASE_URL` uses `mysql` as the host —
the compose service name, not `127.0.0.1` and not the Windows value. The
password appears twice and must match. And if it contains `@ : / ?`, percent-
encode it in `DATABASE_URL` only, because that one is a URL.

**Add the redirect URI in Google Cloud** before starting: Credentials → your
OAuth client → Authorised redirect URIs →

```
http://192.168.6.190:3100/api/auth/callback/google
```

It must match `AUTH_URL` exactly or sign-in fails with `redirect_uri_mismatch`.
Your existing localhost URI can stay alongside it; a client holds as many as you
like.

**Start it:**

```bash
docker compose up -d --build
docker compose logs -f app
```

The first build pulls Node and MySQL and takes several minutes. The app waits
for MySQL, pushes the schema, seeds the faculty list, then starts.

Open `http://192.168.6.190:3100`, sign in, approve Drive access, choose a folder,
upload a book.

---

## Part 6 — A public address

Your existing tunnel runs on the other VM. Two options.

**Point the existing tunnel at this VM.** cloudflared reaches any host it can
route to, so no second tunnel is needed. On the VM already running it, add an
ingress rule:

```yaml
ingress:
  # existing rules stay above this one
  - hostname: library.your-domain
    service: http://192.168.6.190:3100
  - service: http_status:404
```

**Or run a tunnel here.** Cleaner separation — this VM stays up when the other
one is rebooted:

```bash
curl -L -o cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login
cloudflared tunnel create book-portal
cloudflared tunnel route dns book-portal library.your-domain
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: book-portal
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: library.your-domain
    service: http://localhost:3100
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Either way, `http_status:404` must stay last — cloudflared matches top to bottom
and ignores everything after the catch-all.

Then change two things together:

```
AUTH_URL=https://library.your-domain
```

and add `https://library.your-domain/api/auth/callback/google` in Google Cloud.
Auth.js validates the callback against `AUTH_URL`, so changing one without the
other breaks sign-in. Restart afterwards:

```bash
cd /opt/book-portal && docker compose up -d
```

---

## Updating

```bash
cd /opt/book-portal
git pull
docker compose up -d --build
```

The entrypoint runs `prisma db push` on every start, so schema changes apply
themselves. `.env` is untracked and survives the pull.

## Backing up

The books live in Google Drive, so what is on this VM is the catalogue - and
the cover thumbnails now live inside it too, so one dump covers both:

```bash
docker compose exec mysql mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" bookportal \
  | gzip > ~/bookportal-$(date +%F).sql.gz
```

An ESXi snapshot before each `git pull` is the cheaper habit, as long as you
delete the snapshots afterwards — a forgotten snapshot chain fills a datastore
faster than anything else on that box.

## If something goes wrong

```bash
cd /opt/book-portal
docker compose logs --tail 100 app
docker compose ps
docker compose down          # containers only, data survives
```

`down -v` also deletes the volumes, which means the catalogue and every
thumbnail. That is the one command worth typing slowly.

## One loose end

The Google client secret was pasted into a chat window earlier. Rotate it before
this repository exists on GitHub: add a new secret on the OAuth client, update
`.env` on both machines, then delete the old one.
