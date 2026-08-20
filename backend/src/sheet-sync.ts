import * as db from './db';
import * as sheets from './sheets';

/**
 * The intake sheet as a second editor of the project title and description.
 *
 * Ops fill the brainstorm outcome into either the dashboard or the sheet, and
 * whichever they use has to reach the other. The dashboard direction already
 * exists (the Project Setup endpoint mirrors into the row); this is the pass
 * that reads the other way.
 *
 * It does one thing: keep project_setups' title/description level with the
 * sheet. It never touches the curriculum subject (dashboard-only) and never
 * runs a setup step -- Drive, COSMIC and the SYNC mentor link stay behind the
 * mentor gate in the project-setup service, exactly as before.
 *
 * ## Why a stored copy rather than timestamps
 *
 * Two writers, no shared clock, and the dashboard's own mirror-write lands in
 * the sheet as what looks like a fresh edit. `sheet_details_seen` is what the
 * sheet last held as far as we know, so "the sheet was edited" is
 * `sheet != seen` rather than "the sheet is newer". Both writers keep it
 * current, so the mirror-write cannot bounce back.
 */

export interface SheetSyncSummary {
  /** Cases carrying a sheet row -- the set considered. */
  considered: number;
  /** Rows whose sheet values had never been recorded, adopted as a baseline. */
  baselined: number;
  /** Sheet edits written back to the database. */
  updated: number;
  /** Cases made eligible for setup by having a title and a description. */
  submitted: number;
  skipped: number;
  errors: number;
}

const differs = (
  a: { title: string; description: string },
  b: { title: string; description: string }
) => a.title !== b.title || a.description !== b.description;

export async function runSheetSync(): Promise<SheetSyncSummary> {
  const summary: SheetSyncSummary = {
    considered: 0,
    baselined: 0,
    updated: 0,
    submitted: 0,
    skipped: 0,
    errors: 0,
  };

  if (!sheets.sheetsConfigured()) {
    console.warn('sheet sync: Sheets is not configured, nothing to read');
    return summary;
  }

  const [bySheetRow, cases] = await Promise.all([
    sheets.readProjectDetails(),
    db.listCasesForSheetSync(),
  ]);
  summary.considered = cases.length;

  for (const entry of cases) {
    const fromSheet = bySheetRow.get(entry.sheetRow);
    if (!fromSheet) {
      // The row is gone (deleted, or the tab was re-cut). Leave the case be:
      // its details are already stored, and guessing at a new row number would
      // be worse than doing nothing.
      summary.skipped += 1;
      continue;
    }

    // A blank title is never an edit. Sheets returns '' for an untouched cell
    // just as it does for a cleared one, and wiping a real project title on
    // the strength of that is not a trade worth making.
    if (!fromSheet.title) {
      summary.skipped += 1;
      continue;
    }

    try {
      const setup = entry.setup;

      // Never seen before. On a case that already has details this is the
      // first pass after deploy, so the sheet is adopted as the baseline
      // without overwriting anything -- the dashboard's copy stands. On a case
      // with no details at all, the sheet is the only source there is.
      if (!setup) {
        if (!fromSheet.description) {
          summary.skipped += 1;
          continue;
        }
        await db.applySheetDetails(entry.caseId, {
          projectTitle: fromSheet.title,
          projectDescription: fromSheet.description,
          submit: true,
          seen: fromSheet,
          revision: 1,
        });
        summary.updated += 1;
        summary.submitted += 1;
        console.log(`[${entry.caseId}] project details taken from sheet row ${entry.sheetRow}`);
        continue;
      }

      if (!setup.sheetDetailsSeen) {
        await db.markSheetDetailsSeen(entry.caseId, fromSheet);
        summary.baselined += 1;
        continue;
      }

      if (!differs(fromSheet, setup.sheetDetailsSeen)) {
        summary.skipped += 1;
        continue;
      }

      // The sheet moved. Whether that is also a change to what is stored is a
      // separate question: if the dashboard already wrote these exact values
      // and only the mirror-write was late, record the sheet as seen and leave
      // the revision alone so nothing is needlessly re-run.
      const storedMatches = !differs(fromSheet, {
        title: setup.projectTitle ?? '',
        description: setup.projectDescription ?? '',
      });
      if (storedMatches) {
        await db.markSheetDetailsSeen(entry.caseId, fromSheet);
        summary.baselined += 1;
        continue;
      }

      // Eligible once the row carries both a name and a description. Already
      // submitted cases keep their original submitted_at -- an edit is not a
      // new submission, and re-stamping it would reorder the setup queue.
      const submit = Boolean(fromSheet.description) && !setup.submittedAt;

      await db.applySheetDetails(entry.caseId, {
        projectTitle: fromSheet.title,
        projectDescription: fromSheet.description || null,
        submit,
        seen: fromSheet,
        revision: setup.detailsRevision + 1,
        reopen: setup.status === 'DONE',
      });
      summary.updated += 1;
      if (submit) summary.submitted += 1;
      console.log(
        `[${entry.caseId}] project details updated from sheet row ${entry.sheetRow}` +
          (submit ? ' (now eligible for setup)' : '')
      );
    } catch (err) {
      summary.errors += 1;
      console.error(`[${entry.caseId}] sheet sync failed:`, err);
    }
  }

  return summary;
}
