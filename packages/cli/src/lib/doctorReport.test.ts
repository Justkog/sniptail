import { describe, expect, it } from 'vitest';
import {
  formatDoctorReport,
  getDoctorExitCode,
  runDoctorChecks,
  type DoctorCheck,
} from './doctorReport.js';

describe('doctor report primitives', () => {
  it('formats mixed status rows with aligned columns', () => {
    const checks: DoctorCheck[] = [
      {
        status: 'ok',
        area: 'command',
        message: 'Doctor command contract resolved.',
      },
      {
        status: 'warn',
        area: 'env file',
        message: '.env is missing; .env.example exists.',
      },
      {
        status: 'fail',
        area: 'db/worker',
        message: 'Pending worker migrations found.',
      },
    ];

    expect(formatDoctorReport(checks)).toBe(
      [
        'Status  Area       Message',
        'ok      command    Doctor command contract resolved.',
        'warn    env file   .env is missing; .env.example exists.',
        'fail    db/worker  Pending worker migrations found.',
        '',
      ].join('\n'),
    );
  });

  it('formats multiple fix lines below their checks', () => {
    const checks: DoctorCheck[] = [
      {
        status: 'fail',
        area: 'db/bot',
        message: 'Pending bot migrations found.',
        fix: 'Run "sniptail db migrate --scope bot".',
      },
      {
        status: 'fail',
        area: 'db/worker',
        message: 'Pending worker migrations found.',
        fix: 'Run "sniptail db migrate --scope worker".',
      },
    ];

    expect(formatDoctorReport(checks)).toBe(
      [
        'Status  Area       Message',
        'fail    db/bot     Pending bot migrations found.',
        '        fix        Run "sniptail db migrate --scope bot".',
        'fail    db/worker  Pending worker migrations found.',
        '        fix        Run "sniptail db migrate --scope worker".',
        '',
      ].join('\n'),
    );
  });

  it('returns exit 0 for all ok rows', () => {
    expect(
      getDoctorExitCode([
        {
          status: 'ok',
          area: 'command',
          message: 'Ready.',
        },
      ]),
    ).toBe(0);
  });

  it('returns exit 0 for warnings without failures', () => {
    expect(
      getDoctorExitCode([
        {
          status: 'warn',
          area: 'env file',
          message: '.env is missing; .env.example exists.',
        },
      ]),
    ).toBe(0);
  });

  it('returns exit 1 when any row fails', () => {
    expect(
      getDoctorExitCode([
        {
          status: 'ok',
          area: 'command',
          message: 'Ready.',
        },
        {
          status: 'fail',
          area: 'db/worker',
          message: 'Pending worker migrations found.',
        },
      ]),
    ).toBe(1);
  });

  it('runs checks and flattens single and multiple returned rows', async () => {
    const report = await runDoctorChecks([
      () => ({
        status: 'ok',
        area: 'command',
        message: 'Ready.',
      }),
      () =>
        Promise.resolve([
          {
            status: 'warn',
            area: 'env file',
            message: '.env is missing; .env.example exists.',
          },
          {
            status: 'ok',
            area: 'bot config',
            message: 'Resolved bot config.',
          },
        ]),
    ]);

    expect(report.exitCode).toBe(0);
    expect(report.checks).toEqual([
      {
        status: 'ok',
        area: 'command',
        message: 'Ready.',
      },
      {
        status: 'warn',
        area: 'env file',
        message: '.env is missing; .env.example exists.',
      },
      {
        status: 'ok',
        area: 'bot config',
        message: 'Resolved bot config.',
      },
    ]);
  });

  it('converts thrown errors into fail rows and continues', async () => {
    const report = await runDoctorChecks([
      () => {
        throw new Error('boom');
      },
      () => ({
        status: 'ok',
        area: 'command',
        message: 'Still ran.',
      }),
    ]);

    expect(report.exitCode).toBe(1);
    expect(report.checks).toEqual([
      {
        status: 'fail',
        area: 'doctor',
        message: 'Unexpected doctor check error: boom',
      },
      {
        status: 'ok',
        area: 'command',
        message: 'Still ran.',
      },
    ]);
  });
});
