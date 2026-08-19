"use client"

import useSWR from "swr"

import {
  getCase,
  getCaseActions,
  getProjectSetup,
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

export function useCurriculumSubjects() {
  return useSWR("curriculum-subjects", () => listCurriculumSubjects())
}
