export function stripPackageScriptSeparator(argv: string[]): string[] {
  if (argv[2] !== '--') {
    return argv;
  }
  return [argv[0] ?? '', argv[1] ?? '', ...argv.slice(3)];
}
