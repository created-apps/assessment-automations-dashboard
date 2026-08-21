import path from 'node:path';

// Load .env here rather than relying on a CLI flag, so the app picks up its
// config however it's started. Real environment variables win.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // No .env file -- fall back to the ambient environment.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} -- set it in .env`);
    process.exit(1);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.error(`${name} must be a number, got "${raw}"`);
    process.exit(1);
  }
  return parsed;
}

function optional(name: string): string {
  return (process.env[name] ?? '').trim();
}

/**
 * The Google service account, from the base64 of its JSON key
 * (GOOGLE_CREDENTIALS_BASE64 -- the same variable the Automations service
 * uses). Returns null when unset or unparseable, so the Sheets writes just
 * skip rather than crashing the whole service.
 */
function googleFromBase64(): { clientEmail: string; privateKey: string } | null {
  const encoded = optional('GOOGLE_CREDENTIALS_BASE64');
  if (!encoded) return null;
  try {
    const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!json.client_email || !json.private_key) return null;
    return {
      clientEmail: String(json.client_email),
      privateKey: String(json.private_key).replace(/\\n/g, '\n'),
    };
  } catch {
    console.error('GOOGLE_CREDENTIALS_BASE64 is not valid base64 service-account JSON');
    return null;
  }
}

/**
 * The people a session can be booked with, and where their calendar lives.
 *
 * Keyed by the name Slack is expected to type; the value is the booking URL.
 * Matching is fuzzy, so "urja javeri" still finds "Urja Jhaveri" -- the keys
 * here are the canonical spelling used in the WhatsApp message.
 */
function bookingHosts(): { name: string; url: string }[] {
  const hosts = [
    { name: 'Aashna Saraf', env: 'CALENDLY_AASHNA_SARAF' },
    { name: 'Urja Jhaveri', env: 'CALENDLY_URJA_JHAVERI' },
    { name: 'Dhruv Singh', env: 'CALENDLY_DHRUV_SINGH' },
  ];

  const configured = hosts
    .map((h) => ({ name: h.name, url: (process.env[h.env] ?? '').trim() }))
    .filter((h) => h.url.length > 0);

  if (configured.length === 0) {
    console.error(
      'No booking links set -- set at least one of ' +
        hosts.map((h) => h.env).join(', ')
    );
    process.exit(1);
  }
  return configured;
}

const syncUrl = optional('SYNC_SUPABASE_URL').replace(/\/+$/, '');
const syncKey = optional('SYNC_SUPABASE_SERVICE_KEY');

export const config = {
  port: num('PORT', 3000),

  supabase: {
    // The group-creation service's project. This service's two tables live
    // there too (sql/001_init.sql) and are reached over PostgREST.
    url: required('SUPABASE_URL').replace(/\/+$/, ''),
    // Service-role key: these reads and writes bypass row-level security.
    serviceKey: required('SUPABASE_SERVICE_KEY'),
  },

  periskope: {
    apiKey: required('PERISKOPE_API_KEY'),
    phone: required('PERISKOPE_PHONE'),
    baseUrl: process.env.PERISKOPE_BASE_URL ?? 'https://api.periskope.app/v1',
  },

  /**
   * Slack is outbound only: nudges are posted, nothing is read. The bot needs
   * chat:write and nothing else -- channels:history is no longer required.
   */
  slack: {
    botToken: required('SLACK_BOT_TOKEN'),
    // Where each group's thread is opened, and its nudges posted.
    channel: required('SLACK_CHANNEL_ID'),
    baseUrl: process.env.SLACK_BASE_URL ?? 'https://slack.com/api',
  },

  dashboard: {
    /**
     * Bearer token the dashboard's server sends on /api/*. The dashboard is
     * the only client, and it calls from its own server -- this never reaches
     * a browser, and neither does anything it protects.
     */
    secret: required('DASHBOARD_API_SECRET'),
    /**
     * Where the team goes to act on a group. Linked from every Slack nudge,
     * since the nudge is now a notification rather than something to reply to.
     */
    url: (process.env.DASHBOARD_URL ?? '').trim().replace(/\/+$/, ''),
  },

  intake: {
    // Shared with the group-creation service; sent as a bearer token on
    // POST /group-created so the endpoint isn't open to the internet.
    secret: required('INTAKE_SHARED_SECRET'),
  },

  assessments: {
    computerScience:
      process.env.CS_ASSESSMENT_URL ??
      'https://docs.google.com/forms/d/e/1FAIpQLSex5LuvsmlAf6GG6f7RoFsOGMQ_4vgjyXEji1rMM_eG_MQ9Lw/viewform?usp=sf_link',
    prototyping:
      process.env.PROTOTYPING_ASSESSMENT_URL ??
      'https://docs.google.com/forms/d/e/1FAIpQLSdrh1pzdFH8XG5QMZcXpo3EX6a5wl4wN9rgb_oj__XsU8AMPg/viewform?usp=sf_link',
  },

  /**
   * The Google Form response sheets for the two assessments. When a student's
   * email shows up in one of these, they have completed that assessment -- the
   * completion cron checks them and posts to Slack. Optional per assessment:
   * an unset sheet id means that assessment isn't checked. Share each sheet
   * with the service account (GOOGLE_CREDENTIALS_BASE64) so it can read them.
   */
  assessmentResponses: {
    cs: {
      sheetId: optional('CS_RESPONSES_SHEET_ID'),
      tab: optional('CS_RESPONSES_TAB') || 'Form Responses 1',
    },
    prototyping: {
      sheetId: optional('PROTOTYPING_RESPONSES_SHEET_ID'),
      tab: optional('PROTOTYPING_RESPONSES_TAB') || 'Form Responses 1',
    },
    // The column in the response sheet holding the respondent's email.
    emailColumn: optional('ASSESSMENT_RESPONSES_EMAIL_COLUMN') || 'Email Address',
    // Stop checking a case this many days after its assessment was sent.
    checkWindowDays: num('ASSESSMENT_CHECK_WINDOW_DAYS', 30),
  },

  booking: {
    hosts: bookingHosts(),
  },

  curriculum: {
    // Subject labels the dashboard's Project Setup action offers. These must
    // match the keys in the project-setup service's CURRICULUM_TEMPLATES_JSON,
    // since that service maps the chosen label to a Drive template folder.
    // Comma separated; blank means none are configured yet.
    subjects: (process.env.CURRICULUM_SUBJECTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  nudge: {
    // Daily at 09:30. The ask is "every 24 hours"; a fixed hour keeps it
    // landing in working time rather than drifting to whenever we deployed.
    cron: process.env.NUDGE_CRON ?? '30 9 * * *',
    // Don't re-ask a thread that was nudged less than this long ago, whatever
    // the cron does -- a redeploy must not produce a second nudge that day.
    minIntervalHours: num('NUDGE_MIN_INTERVAL_HOURS', 20),
    /**
     * 0 -- the default -- means never stop asking. A group keeps being chased
     * until a mentor is actually introduced, because a case that quietly
     * stopped being nudged is a student nobody is coming back to.
     *
     * Set a positive number of days to restore a cutoff, after which the case
     * is marked ABANDONED and left alone.
     */
    giveUpAfterDays: num('NUDGE_GIVE_UP_AFTER_DAYS', 0),
  },

  mentors: {
    // Below this score a name is reported back to Slack as unmatched rather
    // than being guessed at -- sending the wrong mentor's intro to a parent is
    // much worse than asking whoever replied to spell the name again.
    minMatchScore: num('MENTOR_MIN_MATCH_SCORE', 0.72),
    // Two candidates within this of each other are treated as ambiguous.
    ambiguityMargin: num('MENTOR_AMBIGUITY_MARGIN', 0.05),
  },

  /**
   * SYNC's Supabase project. Used at mentor-introduction time to look up the
   * mentor's phone/email and to link them into user_group_memberships.
   * Optional: unset and those side-effects are skipped (with a warning).
   */
  sync: {
    url: syncUrl,
    serviceKey: syncKey,
    configured: Boolean(syncUrl && syncKey),
    // How a mentor's number is written into users.phone_number. Lookups always
    // try both shapes; this only decides the format of rows we insert, and it
    // matches USER_PHONE_FORMAT in the group-creation service, which writes
    // students and parents into the same table.
    phoneFormat: (process.env.USER_PHONE_FORMAT ?? 'digits') as 'digits' | 'plus',
  },

  /** Google service account (shared with the Automations service). */
  google: {
    creds: googleFromBase64(),
  },

  /**
   * The intake Google Sheet. Mentor details and the project title/description
   * are written back to the student's row here. Optional -- unset and the
   * writes are skipped.
   */
  sheet: {
    id: optional('GOOGLE_SHEET_ID'),
    tab: optional('GOOGLE_SHEET_TAB') || 'Sheet1',
  },

  jobs: {
    /**
     * Reading the project title/description back out of the intake sheet. One
     * Sheets request per tick covers every case, so this can run often; the
     * bound worth respecting is the Sheets read quota, not our own cost.
     */
    sheetSyncCron: optional('SHEET_SYNC_CRON') || '*/5 * * * *',
    /** Retrying the SYNC accounts of mentors added while SYNC was down. */
    mentorSyncCron: optional('MENTOR_SYNC_CRON') || '*/15 * * * *',
    /**
     * Draining the per-case action queues. Every minute: the runner sends at
     * most one action per case per tick, so the real pacing dial is
     * queue.gapSeconds below, not this.
     */
    queueCron: optional('QUEUE_CRON') || '* * * * *',
    /**
     * Checking the assessment response sheets for newly completed forms.
     * Hourly by default; each tick reads the two response sheets once.
     */
    assessmentCompletionCron: optional('ASSESSMENT_COMPLETION_CRON') || '0 * * * *',
  },

  queue: {
    /**
     * How long to leave between two queued messages to the same group. A
     * family that has just joined and read the welcome should not get the
     * assessment, the mentor introduction and a booking link in the same
     * breath.
     */
    gapSeconds: num('QUEUE_GAP_SECONDS', 60),
  },
} as const;
