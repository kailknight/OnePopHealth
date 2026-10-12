# PopHealth site

A static website for GitHub Pages with a username login, a configurable main page, and an admin dashboard with a drag-and-drop page designer. It uses plain HTML, CSS and JS, with no build step.

| Page | File | Purpose |
|---|---|---|
| Login | `index.html` | Enter a username listed in `data/users.json` |
| Main | `main.html` | Renders `data/layout.json`; shows **Admin Dashboard** button for Admin users |
| Admin | `admin.html` | Page designer, user management, publish |

## Deploy to GitHub Pages

1. Create a repo on GitHub and push this folder:
   ```bash
   git init && git add . && git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/kailknight/OnePopHealth.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages → Build and deployment**, set Source to **Deploy from a branch**, then pick `main` and `/ (root)`.
3. Open `https://kailknight.github.io/OnePopHealth/` and log in as `admin`.

## Using the admin dashboard

- **Page designer:** drag blocks (hero, heading, paragraph, image, button, card, list, video, divider, spacer) onto the page. Drag them to reorder, and click one to edit its properties. Click empty space to edit page-wide settings (title, colours, font, width). Set a block's **Width** to 1/2, 1/3 and so on to put blocks side by side.
- **Users:** add or remove users and set their role (`User` or `Admin`).
- **Publish:** edits are saved as a *draft in your browser* until you publish. Publishing commits `data/layout.json` and `data/users.json` to the repo through the GitHub API, using a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) limited to this repo with **Contents: Read and write**. If you'd rather not use a token, download the JSON files and commit them yourself.

## Run locally

`fetch()` doesn't work over `file://`, so serve the folder. For example: `npx serve .` or `python -m http.server`.

## ⚠️ Security note

GitHub Pages only serves static files, so this login is **not secure**. Anyone can type `admin`, and `data/users.json` is public. That's fine for demos, internal prototypes and personalising content. It is **not** suitable for protecting private or health data. For real authentication, put the site behind a real identity provider, such as Azure Static Web Apps auth, Cloudflare Access, Auth0 or Firebase Auth.

The publish token never goes into the repo. It's kept in your browser only if you tick "Remember token".
