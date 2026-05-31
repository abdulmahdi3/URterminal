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

/** The instruction injected into the agent so it knows how to drive the server. */
export function buildAgentInstruction(target: string, helperPath: string): string {
  const q = `"${helperPath}"`
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
