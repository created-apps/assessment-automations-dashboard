"use client"

import useSWR from "swr"

import {
  getCase,
  getCaseActions,
  getProjectSetup,
  getQueue,
  listCaseSummaries,
  listCurriculumSubjects,
  listMentors,
} from "@/lib/api"

export function useCases() {
  return useSWR("cases", () => listCaseSummaries())
}

export function useCase(id: string | null) {
  return useSWR(id ? ["case", id] : null, () => getCase(id as string))
}

export function useCaseActions(id: string | null) {
  return useSWR(id ? ["case-actions", id] : null, () =>
    getCaseActions(id as string),
  )
}

export function useMentors() {
  return useSWR("mentors", () => listMentors())
}

export function useProjectSetup(id: string | null) {
  return useSWR(id ? ["project-setup", id] : null, () =>
    getProjectSetup(id as string),
  )
}

/** What is lined up for a case, in the order it will run. */
export function useQueue(id: string | null) {
  return useSWR(id ? ["queue", id] : null, () => getQueue(id as string))
}

export function useCurriculumSubjects() {
  return useSWR("curriculum-subjects", () => listCurriculumSubjects())
}
