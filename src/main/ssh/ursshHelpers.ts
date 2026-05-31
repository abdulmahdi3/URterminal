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
 * The instruction injected into the agent so it knows how to drive the server.
 * When `mountPath` is given, the server's files are mounted locally there (SFTP),
 * so the agent edits files like a normal local folder and only uses the helper to
 * RUN commands on the server. Without a mount it's the helper for everything.
 */
export function buildAgentInstruction(target: string, helperPath: string, mountPath?: string): string {
  const q = `"${helperPath}"`
  if (mountPath) {
    return [
      `You are operating the remote server ${target}. Nothing is installed on the server.`,
      ``,
      `FILES: the server's files are mounted locally at ${mountPath} — you are in that folder now.`,
      `Read, navigate (cd into subfolders), create and EDIT files here directly with your normal`,
      `file tools; every change is written straight to the server over SFTP. Treat it as a normal`,
      `local project folder.`,
      ``,
      `RUNNING COMMANDS ON THE SERVER (build, test, git, services): a plain shell command runs on`,
      `THIS local machine, NOT the server. To run something ON the server, call this helper and`,
      `pass the entire command as ONE double-quoted argument:`,
      `  ${q} "<command>"`,
      `Examples:`,
      `  ${q} "uname -a"`,
      `  ${q} "cd <dir> && make"`,
      `  ${q} "systemctl status nginx | cat"`,
      ``,
      `Begin by exploring the mounted files and the server (OS, hostname, disk), then help me.`
    ].join('\n')
  }
  return [
    `You are now operating the remote server ${target} over SSH, from this LOCAL shell.`,
    `Nothing is installed on the server. To run ANY command on it, call this helper and pass the`,
    `entire command as ONE double-quoted argument:`,
    `  ${q} "<command>"`,
    `Examples:`,
    `  ${q} "uname -a"`,
    `  ${q} "ls -la /var/log"`,
    `  ${q} "ps aux | grep nginx"`,
    `The helper reuses one authenticated SSH connection, so there is no password prompt. Use it for`,
    `every server action. Begin by exploring the server (OS, hostname, current directory, disk),`,
    `then help me manage it.`
  ].join('\n')
}
