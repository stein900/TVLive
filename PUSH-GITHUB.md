# Pousser TVLive sur GitHub

GitHub **n'accepte plus votre mot de passe** à la place de « Password ».  
Il faut soit **SSH**, soit un **token**, soit `gh auth login`.

---

## Méthode 1 — SSH (recommandée, déjà préparée)

### Étape A — Ajouter la clé sur GitHub (une fois)

1. Ouvrez : https://github.com/settings/ssh/new  
2. **Title** : `TVLive PC` (ou ce que vous voulez)  
3. **Key** : collez **toute** la ligne affichée par :

```bash
cat ~/.ssh/id_ed25519.pub
```

4. Cliquez **Add SSH key**

### Étape B — Push

```bash
cd /home/stein/Documents/TVLive
git push -u origin main
```

La première fois, tapez `yes` si Git demande de faire confiance à `github.com`.

---

## Méthode 2 — GitHub CLI (navigateur)

```bash
gh auth login
```

Choisissez : **GitHub.com** → **HTTPS** → **Login with a web browser** → copiez le code affiché.

Puis :

```bash
cd /home/stein/Documents/TVLive
git remote set-url origin https://github.com/stein900/TVLive.git
git push -u origin main
```

---

## Méthode 3 — Token HTTPS

1. https://github.com/settings/tokens → **Generate new token (classic)**  
2. Cochez **repo**  
3. Copiez le token (une seule fois visible)

```bash
cd /home/stein/Documents/TVLive
git remote set-url origin https://github.com/stein900/TVLive.git
git push -u origin main
```

- **Username** : `stein900`  
- **Password** : collez le **token** (pas votre mot de passe GitHub)
