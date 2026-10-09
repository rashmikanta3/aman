# Set Up SSH for GitHub and Clone a Repository (Windows)

This guide shows how to generate an SSH key, add it to GitHub, and clone the `aman` repository over SSH using PowerShell.

## Step 1: Check for an existing SSH key

```powershell
ls ~\.ssh\id_ed25519.pub
```

If the file exists, skip to [Step 3](#step-3-add-the-key-to-your-github-account). If you get a "cannot find path" error, continue to Step 2.

## Step 2: Generate a new SSH key

Run the keygen command. Press **Enter** to accept the default file location. You can also press Enter at the passphrase prompts to leave it empty, or set a passphrase for extra protection.

```powershell
ssh-keygen -t ed25519 -C "rashmikanta3"
```

Copy the public key to your clipboard:

```powershell
Get-Content ~\.ssh\id_ed25519.pub | Set-Clipboard
```

> Only share the `.pub` file. Never share `id_ed25519` (the private key).

## Step 3: Add the key to your GitHub account

1. Go to [GitHub SSH Keys Settings](https://github.com/settings/keys).
2. Click **New SSH key**.
3. Enter a **Title** (for example, `Windows Desktop`).
4. Paste the copied key into the **Key** field.
5. Click **Add SSH key**.

## Step 4: Test the connection and clone

Verify the connection to GitHub:

```powershell
ssh -T git@github.com
```

You should see:

```text
Hi rashmikanta3! You've successfully authenticated, but GitHub does not provide shell access.
```

The first time you connect, SSH asks whether to trust GitHub's host. Type `yes` to continue.

Once confirmed, clone the repository:

```powershell
git clone git@github.com:rashmikanta3/aman.git
```

## Alternative: Clone with HTTPS

If you don't want to set up an SSH key on this PC, clone over HTTPS instead:

```powershell
git clone https://github.com/rashmikanta3/aman.git
```

If the repository is private, Git will ask you to sign in through the browser or enter a personal access token instead of your password.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Permission denied (publickey)` | The key wasn't added to GitHub, or you pasted the wrong file. Repeat Step 3 using the `.pub` file. |
| `ssh-keygen` is not recognized | Install the OpenSSH Client: **Settings → Apps → Optional features → Add a feature → OpenSSH Client**. |
| `Repository not found` | Check the repository name and that your account has access. |
