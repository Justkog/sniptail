export type DoctorStatus = 'ok' | 'warn' | 'fail';

export type DoctorCheck = {
  status: DoctorStatus;
  area: string;
  message: string;
  fix?: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  exitCode: 0 | 1;
};

export type DoctorCheckRunner = () =>
  | DoctorCheck
  | DoctorCheck[]
  | Promise<DoctorCheck | DoctorCheck[]>;

const MIN_STATUS_WIDTH = 'Status'.length;
const MIN_AREA_WIDTH = 'command'.length;

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function maxLength(values: string[], minimum: number): number {
  return values.reduce((max, value) => Math.max(max, value.length), minimum);
}

export function getDoctorExitCode(checks: readonly DoctorCheck[]): 0 | 1 {
  return checks.some((check) => check.status === 'fail') ? 1 : 0;
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const statusWidth = maxLength(
    ['Status', ...checks.map((check) => check.status)],
    MIN_STATUS_WIDTH,
  );
  const areaWidth = maxLength(
    ['Area', ...checks.flatMap((check) => (check.fix ? [check.area, 'fix'] : [check.area]))],
    MIN_AREA_WIDTH,
  );

  const lines = [`${'Status'.padEnd(statusWidth)}  ${'Area'.padEnd(areaWidth)}  Message`];
  for (const check of checks) {
    lines.push(
      `${check.status.padEnd(statusWidth)}  ${check.area.padEnd(areaWidth)}  ${check.message}`,
    );
    if (check.fix) {
      lines.push(`${''.padEnd(statusWidth)}  ${'fix'.padEnd(areaWidth)}  ${check.fix}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function runDoctorChecks(checks: DoctorCheckRunner[]): Promise<DoctorReport> {
  const collected: DoctorCheck[] = [];

  for (const check of checks) {
    try {
      const result = await check();
      collected.push(...(Array.isArray(result) ? result : [result]));
    } catch (err) {
      collected.push({
        status: 'fail',
        area: 'doctor',
        message: `Unexpected doctor check error: ${stringifyError(err)}`,
      });
    }
  }

  return {
    checks: collected,
    exitCode: getDoctorExitCode(collected),
  };
}
