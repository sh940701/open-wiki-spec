/**
 * Output formatters for CLI commands.
 */
import type { VerifyReport } from '../../types/verify.js';

/**
 * Format a VerifyReport as human-readable text.
 */
export function formatVerifyReport(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(`Verify Report (${report.scanned_at})`);
  lines.push(`Total notes scanned: ${report.total_notes}`);
  lines.push(`Result: ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');

  // Summary
  for (const [dim, counts] of Object.entries(report.summary)) {
    if (counts.errors === 0 && counts.warnings === 0 && counts.info === 0) continue;
    lines.push(`  ${dim}: ${counts.errors} errors, ${counts.warnings} warnings, ${counts.info} info`);
  }

  if (report.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');

    // Errors first
    const errors = report.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      lines.push('');
      lines.push('  ERRORS:');
      for (const issue of errors) {
        lines.push(`    [${issue.code}] ${issue.message}`);
        if (issue.note_path) lines.push(`      at: ${issue.note_path}`);
        if (issue.suggestion) lines.push(`      fix: ${issue.suggestion}`);
      }
    }

    // Warnings
    const warnings = report.issues.filter((i) => i.severity === 'warning');
    if (warnings.length > 0) {
      lines.push('');
      lines.push('  WARNINGS:');
      for (const issue of warnings) {
        lines.push(`    [${issue.code}] ${issue.message}`);
        if (issue.suggestion) lines.push(`      fix: ${issue.suggestion}`);
      }
    }

    // Info
    const infos = report.issues.filter((i) => i.severity === 'info');
    if (infos.length > 0) {
      lines.push('');
      lines.push('  INFO:');
      for (const issue of infos) {
        lines.push(`    [${issue.code}] ${issue.message}`);
      }
    }
  }

  return lines.join('\n');
}
