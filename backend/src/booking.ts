import { config } from './config';
import { matchName, type MatchResult } from './match';

export interface BookingHost {
  name: string;
  url: string;
}

export const hosts: BookingHost[] = [...config.booking.hosts];

/**
 * Whoever the reply asked to book with.
 *
 * The margin is wider than the mentor one: there are only a handful of hosts
 * and their names look nothing alike, so a near-tie really is a typo rather
 * than a genuine ambiguity.
 */
export function findHost(query: string): MatchResult<BookingHost> {
  return matchName(query, hosts, (h) => h.name, {
    minScore: 0.6,
    ambiguityMargin: 0.02,
  });
}
