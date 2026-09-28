import * as db from './db';
import * as sheets from './sheets';
import {
  considerRow as considerMentorRow,
  emptySummary as emptyMentorSummary,
  SyncDirectory,
  type MentorIntakeSummary,
} from './mentor-intake';

/**
 * The intake sheet as a second editor of the project title and description.
 *
 * Ops fill the brainstorm outcome into either the dashboard or the sheet, and
 * whichever they use has to reach the other. The dashboard direction already
 * exists (the Project Setup endpoint mirrors into the row); this is the pass
 * that reads the other way.
 *
 * It keeps project_setups' title/description level with the sheet, and reads
 * the mentor columns off the same values while it is there (see
 * mentor-intake.ts -- that part only ever adds to a case's action queue). It
 * never touches the curriculum subject (dashboard-only) and never runs a setup
 * step -- Drive, COSMIC and the SYNC mentor link stay behind the mentor gate in
 * the project-setup service, exactly as before.
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
  /** What the mentor columns on those same rows came to. */
  mentors: MentorIntakeSummary;
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
    mentors: emptyMentorSummary(),
  };

  if (!sheets.sheetsConfigured()) {
    console.warn('sheet sync: Sheets is not configured, nothing to read');
    return summary;
  }

  const [bySheetRow, cases, mentorQueued] = await Promise.all([
    sheets.readProjectDetails(),
    db.listCasesForSheetSync(),
    db.listCaseIdsWithMentorQueued(),
  ]);
  summary.considered = cases.length;

  // Read from SYNC at most once, and only if some row actually names a mentor.
  const syncDirectory = new SyncDirectory();

  for (const entry of cases) {
    const sheetRow = bySheetRow.get(entry.sheetRow);
    if (!sheetRow) {
      // The row is gone (deleted, or the tab was re-cut). Leave the case be:
      // its details are already stored, and guessing at a new row number would
      // be worse than doing nothing.
      summary.skipped += 1;
      continue;
    }

    // Before the details branches below, all of which skip on their own terms:
    // a row with no title yet can still name the mentor.
    await considerMentorRow(
      entry,
      sheetRow,
      syncDirectory,
      mentorQueued,
      summary.mentors
    );

    const fromSheet = sheetRow.details;

    // A blank title is never an edit. Sheets returns '' for an untouched cell
    // just as it does for a cleared one, and wiping a real project title on
    // the strength of that is not a trade worth making.
    if (!fromSheet.title) {
      summary.skipped += 1;
      continue;
    }

    try {
      const setup = entry.setup;
      const storedTitle = (setup?.projectTitle ?? '').trim();

      // We hold no title, so there is nothing of ours for the sheet to
      // overwrite and the sheet is the only source there is.
      //
      // The test is the stored title, not the absence of a project_setups row.
      // It used to be the row, and that was wrong in a way that was invisible:
      // registerCase writes a row as soon as intake reports a Drive folder, so
      // a case can hold a row carrying nothing but a folder id. Those fell past
      // this branch into the baseline below, which recorded the sheet as "seen"
      // and ingested nothing -- and since ingestion from then on needs the
      // sheet to *differ* from what was seen, a row whose title was already
      // filled in before that first pass was never read at all. Four cases sat
      // like that, each with a title in the sheet and none in the database.
      if (!setup || !storedTitle) {
        if (!fromSheet.description) {
          summary.skipped += 1;
          continue;
        }
        // An existing row may already have been submitted (by the dashboard,
        // with a description but no title -- or by a hand edit). Re-stamping
        // submitted_at would reorder the setup queue, so it is set only once.
        const submit = !setup?.submittedAt;
        await db.applySheetDetails(entry.caseId, {
          projectTitle: fromSheet.title,
          projectDescription: fromSheet.description,
          submit,
          seen: fromSheet,
          revision: (setup?.detailsRevision ?? 0) + 1,
          ...(setup?.status === 'DONE' ? { reopen: true } : {}),
        });
        summary.updated += 1;
        if (submit) summary.submitted += 1;
        console.log(
          `[${entry.caseId}] project details taken from sheet row ${entry.sheetRow}` +
            (setup ? ' (row existed but held no title)' : '') +
            (submit ? ' (now eligible for setup)' : '')
        );
        continue;
      }

      // A title we hold and have never compared against the sheet. Adopt the
      // sheet as the baseline without overwriting: this is the first pass over
      // a case whose details came from the dashboard, and that copy stands.
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
