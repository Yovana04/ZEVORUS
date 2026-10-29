# Zevorus SecOps Management Platform

Web platform for managing Zevorus's SecOps service offering,
including Help Desk, EBC Events, Organizations, and Users.

## Tech Stack
- **Backend:** Node.js + Express + SQLite (better-sqlite3)
- **Auth:** JWT + bcryptjs
- **Frontend:** HTML5 + CSS3 + Vanilla JavaScript
- **API:** REST (JSON)

## Project Structure

```
zevorus-final/
├── backend/              # Express API + SQLite database
└── frontend/
    ├── index.html        # Public marketing site (home)
    ├── Servicios.html
    ├── Nosotros.html
    ├── Contacto.html      # Real lead-capture form → POST /api/contact
    ├── Soporte.html        # Links to the internal portal
    └── app/                # Internal platform (login + dashboard SPA)
        ├── index.html
        ├── css/
        └── js/
```

## Setup & Run

```bash
# 1. Install dependencies
cd backend
npm install

# 2. Start the server (seeds DB automatically on first run)
npm start
# ✅  Zevorus API running on http://localhost:3000

# 3. Open the app
# Visit http://localhost:3000            → public marketing site
# Visit http://localhost:3000/app/       → internal platform (login)
```

## Demo Credentials
| Email | Password | Role |
|---|---|---|
| pablo@zevorus.com | zevorus2026 | Admin |
| mirian@zevorus.com | zevorus2026 | Agent |
| yovana@zevorus.com | zevorus2026 | Agent |
| carlos@grupoalfa.mx | zevorus2026 | Client |

## API Endpoints
| Method | Endpoint | Description |
|---|---|---|
| POST | /api/login | Authenticate user |
| GET | /api/stats | Dashboard metrics |
| GET | /api/tickets | List all tickets |
| POST | /api/tickets | Create ticket |
| PATCH | /api/tickets/:id | Update ticket |
| POST | /api/tickets/:id/comments | Add comment |
| GET | /api/organizations | List organizations |
| POST | /api/organizations | Create organization |
| PATCH | /api/organizations/:id | Update organization |
| GET | /api/events | List EBC events |
| GET | /api/events/:id | Event + participants |
| POST | /api/events | Create event |
| POST | /api/events/:id/participants | Register participant |
| GET | /api/users | List users |
| POST | /api/contact | **Public.** Submit contact form from the marketing site |
| GET | /api/contact | List contact requests (leads) — requires auth |
| PATCH | /api/contact/:id | Update a lead's status — requires auth |
| GET | /api/odoo/status | Check the Odoo connection — requires auth |

## Notificaciones por correo (formulario de Contacto)

Cuando alguien envía el formulario de `Contacto.html`, además de guardarse en
la base de datos, se manda un correo de aviso por Gmail SMTP usando
[nodemailer](https://nodemailer.com/).

**Es opcional.** Sin `SMTP_USER`/`SMTP_PASS` configurados, el formulario
sigue guardando la solicitud normalmente, solo que no manda el correo.

### Setup — sacar una "Contraseña de aplicación" de Gmail
Gmail no deja usar tu contraseña normal para esto por seguridad, así que hay
que generar una específica para la app:

1. Entra a la cuenta de Gmail que va a **enviar** los correos
   (ej. `Yovana.zevorus@gmail.com`) en [myaccount.google.com](https://myaccount.google.com).
2. Ve a **Seguridad**. Si la Verificación en 2 pasos no está activada,
   actívala primero (es obligatorio para poder generar contraseñas de app).
3. Busca **"Contraseñas de aplicaciones"** (o ve directo a
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)).
4. Ponle un nombre como "Zevorus sitio web" y genera la contraseña —
   Google te da un código de 16 caracteres tipo `abcd efgh ijkl mnop`.
5. Copia `backend/.env.example` a `backend/.env` y llena:
   ```
   SMTP_USER=Yovana.zevorus@gmail.com
   SMTP_PASS=abcdefghijklmnop
   CONTACT_EMAIL_TO=Yovana.zevorus@gmail.com
   ```
   (el `SMTP_PASS` va sin espacios, aunque Google te lo muestre con espacios)
6. Reinicia el servidor. Manda una prueba desde `Contacto.html` — debería
   llegarte un correo con asunto "Nueva solicitud de contacto — ...".

`CONTACT_EMAIL_TO` puede ser una cuenta distinta a `SMTP_USER` si quieres
que los avisos lleguen a otro correo distinto del que los envía.

## Odoo Integration

The Help Desk module syncs tickets with **Odoo's Helpdesk app** via JSON-RPC
(Odoo's external API — no extra library needed, just native `fetch`).

**What syncs automatically:**
- Creating a ticket in Zevorus → creates a matching `helpdesk.ticket` in Odoo
- Changing a ticket's priority in Zevorus → updates it in Odoo
- Adding a comment in Zevorus → posts it as a message on the Odoo ticket

**This is entirely optional.** With no Odoo credentials configured, the
platform works 100% normally — tickets just live in the local SQLite DB.

### Setup
1. Get an Odoo instance with the **Helpdesk** app installed (a free
   [Odoo Online](https://www.odoo.com/trial) trial works fine for a demo).
2. In Odoo: **Settings → Users → your user → Account Security tab → API Keys → New API Key**.
3. Copy `backend/.env.example` to `backend/.env` and fill in:
   ```
   ODOO_URL=https://tuempresa.odoo.com
   ODOO_DB=tuempresa
   ODOO_USERNAME=integracion@zevorus.com
   ODOO_API_KEY=<la api key generada>
   ```
4. Restart the server. Check the connection at `GET /api/odoo/status`
   (requires login) — it returns `{ connected: true, uid, url, db }` on success.

### Architecture
```
Zevorus Platform (this app)                Odoo
┌─────────────────────┐   JSON-RPC    ┌──────────────────┐
│ POST /api/tickets    │ ─────────────▶│ helpdesk.ticket   │
│ PATCH /api/tickets/:id│ ─────────────▶│  (create/write)   │
│ POST .../comments     │ ─────────────▶│ mail.message       │
│                       │               │  (create)          │
│  SQLite (source of    │               │                    │
│  truth for the app)   │               │  Odoo (source of   │
│                       │               │  truth for support  │
│                       │               │  agents/reporting)  │
└─────────────────────┘               └──────────────────┘
```
Each local ticket stores the Odoo record's id in its `odoo_id` column, so
updates know exactly which Odoo ticket to touch.

### Syncing stages (optional, advanced)
Odoo Helpdesk tracks status as a **stage** (a kanban column like "New" /
"In Progress" / "Solved"), and each stage has a numeric ID that's different
per Odoo installation. To also sync ticket status:
1. In Odoo, go to Helpdesk → your team → Edit → note the stage IDs (or query
   `helpdesk.stage` via `search_read`).
2. In `backend/server.js`, inside the `PATCH /api/tickets/:id` handler, add
   `odooFields.stage_id = <the right id>` based on the incoming `status`.


- **users** — platform users with RBAC roles (admin/agent/client)
- **organizations** — client/prospect companies
- **tickets** — help desk tickets with MITRE ATT&CK tagging
- **ticket_comments** — activity log per ticket
- **ebc_events** — Executive Immersion Experience sessions
- **ebc_participants** — event registrations
- **contact_requests** — leads submitted through the public site's contact form

## Features
- JWT-based authentication with role-based access
- Full CRUD for tickets, organizations, and EBC events
- MITRE ATT&CK tactic tagging on incidents
- Real-time dashboard with operational metrics
- Participant registration with capacity control
- Comment/activity system on tickets

---

## Cuentas y seguridad (actualización octubre 2026)

- **Base de datos permanente:** usa Turso (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`). Sin esas variables usa el archivo local `backend/zevorus.db`.
- **Confirmación de correo:** al registrarse se envía un enlace (válido 24 h). Sin confirmar no se puede iniciar sesión. Se puede reenviar desde el login.
- **¿Olvidaste tu contraseña?:** envía un enlace (válido 1 h, un solo uso). Se puede reenviar cada 60 s; máximo 5 correos por hora por cuenta.
- **Contraseñas:** mínimo 8 caracteres, una mayúscula, un número y un símbolo.
- **Límite de intentos:** 5 contraseñas incorrectas bloquean la cuenta 15 minutos; 20 fallos desde la misma IP bloquean esa IP 15 minutos. Cambiar la contraseña desbloquea la cuenta.
- **Empresas y líderes:** quien registra una empresa nueva queda como su **líder**. Si alguien se registra con una empresa que ya existe, su cuenta queda **pendiente** hasta que el líder (sección *Mi equipo*) o un admin/agente (página *Users*) la apruebe.
- **Sesión:** dura 8 horas; al vencer, la plataforma regresa al login con un aviso.
- **Equipo Zevorus:** los agentes se crean solos al arrancar con la contraseña inicial `zevorus2026`.
- **Correos:** requieren `SMTP_USER` y `SMTP_PASS` (Gmail → *Contraseñas de aplicación*). Sin ellos no se envían correos y las cuentas nuevas se activan sin confirmar.

## Bot de Telegram (@ZevorusSoporteBot)

Los clientes pueden levantar tickets escribiéndole al bot. Cada ticket:
- entra al **Help Desk** de la plataforma (categoría *Service Request*, prioridad *medium*),
  asignado al agente con menos tickets abiertos; si la empresa no existe se crea como prospecto;
- y se guarda una copia en **Google Sheets** (opcional).

Archivos en `telegram-bot/`:
- `bot_zevorus.py` – el bot. Arriba están `URL_PLATAFORMA`, `URL_GOOGLE_SCRIPT` y `BOT_SECRET`.
- `google-sheet-script.gs` – script que se pega en el Google Sheet (Extensiones → Apps Script).

Para que funcione, `BOT_SECRET` debe ser igual en tres lugares: `backend/.env` (y en las
variables de Render), `bot_zevorus.py` y `google-sheet-script.gs`.

Correr el bot: `pip install -r telegram-bot/requirements.txt` y `python telegram-bot/bot_zevorus.py`
(con la plataforma corriendo). Ruta usada: `POST /api/bot/tickets` con el encabezado `x-bot-secret`.
