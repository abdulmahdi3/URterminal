/**
 * Pure builders for the "agent over SSH" helper script + instruction. Kept free
 * of ssh2/http imports so they can be unit-tested in isolation.
 */

/** Build the Windows `urssh.cmd` helper (the agent calls it by full path). */
export function buildUrsshCmd(opts: { port: number; token: string; target: string }): string {
  // %~1 strips the agent's surrounding quotes; --data-raw avoids curl's @file
  // handling. The whole remote command is sent as the request body, so remote
  // pipes/redirects are parsed by the REMOTE shell, not the local one.
  return [
    '@echo off',
    `curl -s -X POST "http://127.0.0.1:${opts.port}/exec" ` +
      `-H "x-urssh-token: ${opts.token}" -H "x-urssh-target: ${opts.target}" ` +
      '--data-raw "%~1"'
  ].join('\r\n')
}

/** Build the POSIX `urssh` helper. */
export function buildUrsshSh(opts: { port: number; token: string; target: string }): string {
  return [
    '#!/bin/sh',
    `curl -s -X POST "http://127.0.0.1:${opts.port}/exec" \\`,
    `  -H "x-urssh-token: ${opts.token}" -H "x-urssh-target: ${opts.target}" \\`,
    '  --data-raw "$1"'
  ].join('\n')
}

/**
 * Instructions the agent must follow to operate the server. Written to a
 * CLAUDE.md in the agent's working dir (Claude Code reads it automatically), so
 * delivery doesn't depend on fragile auto-typing. When `mountPath` is given the
 * server's files are mounted locally there for editing; otherwise everything
 * goes through the helper.
 */
export function buildAgentInstruction(target: string, helperPath: string, mountPath?: string): string {
  const q = `"${helperPath}"`
  const lines = [
    `# Operating the remote server ${target}`,
    ``,
    `You are running on a LOCAL Windows machine and are connected to the remote server`,
    `**${target}**. Nothing is installed on the server.`,
    ``,
    `## Running commands ON the server`,
    `Your normal Bash/shell tool runs on THIS Windows machine, NOT on the server, and plain`,
    `\`ssh\`/\`scp\` will fail (no interactive password). To run ANY command on the server, call this`,
    `helper, passing the entire command as ONE double-quoted argument:`,
    ``,
    `    ${q} "<command>"`,
    ``,
    `Examples:`,
    `- \`${q} "uname -a"\``,
    `- \`${q} "df -h && free -h"\``,
    `- \`${q} "systemctl status nginx | cat"\``,
    ``,
    `The helper reuses one already-authenticated SSH connection (no password prompt). **Always use`,
    `it for server commands** — do not use your normal Bash tool or \`ssh\` for the server.`,
    ``
  ]
  if (mountPath) {
    lines.push(
      `## Editing the server's files`,
      `The server's files are mounted locally at \`${mountPath}\`. \`cd ${mountPath}\` and read,`,
      `navigate and EDIT them there with your normal file tools — every change is written straight`,
      `to the server over SFTP.`,
      ``
    )
  } else {
    lines.push(
      `## Files`,
      `The server's filesystem is not mounted, so use the helper for file operations too`,
      `(e.g. \`${q} "cat /etc/os-release"\`, \`${q} "ls -la /var/www"\`).`,
      ``
    )
  }
  lines.push(`Start by exploring the server with the helper (OS, hostname, disk, services).`)
  return lines.join('\n')
}
