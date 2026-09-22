import { z } from 'zod'

export const cardCategories = [
  'decision',
  'innovation',
  'opportunity',
  'crisis',
] as const

export const boardStages = [
  'idea',
  'validation',
  'prototype',
  'launch',
  'growth',
  'company',
] as const

export const managementActionIds = [
  'financing',
  'product_improvement',
  'brand_building',
] as const

export const cardIdSchema = z.string().min(1).brand<'CardId'>()
export const cardOptionIdSchema = z.string().min(1).brand<'CardOptionId'>()
export const outcomeIdSchema = z.string().min(1).brand<'OutcomeId'>()

export const resourceVectorSchema = z.object({
  capital: z.number().int(),
  reputation: z.number().int(),
  innovation: z.number().int(),
})

export const outcomeSchema = z.object({
  id: outcomeIdSchema,
  label: z.string().min(1),
  probability: z.number().int().positive(),
  effect: resourceVectorSchema,
  explanation: z.string().min(1),
})

export const cardOptionSchema = z.object({
  id: cardOptionIdSchema,
  label: z.string().min(1),
  isDefault: z.boolean(),
  cost: resourceVectorSchema.refine(
    ({ capital, reputation, innovation }) =>
      capital >= 0 && reputation >= 0 && innovation >= 0,
    'Option costs cannot be negative',
  ),
  outcomes: z.array(outcomeSchema).min(1),
})

export const cardSchema = z.object({
  id: cardIdSchema,
  category: z.enum(cardCategories),
  title: z.string().min(1),
  scenario: z.string().min(1),
  learning: z.string().min(1),
  tags: z.array(z.string().min(1)),
  options: z.array(cardOptionSchema).min(2).max(3),
})

export const boardSpaceSchema = z.object({
  position: z.number().int().min(0).max(30),
  stage: z.enum(boardStages),
  category: z.enum(cardCategories).nullable(),
  cardId: cardIdSchema.nullable(),
})

export const managementActionSchema = z.object({
  id: z.enum(managementActionIds),
  label: z.string().min(1),
  cost: resourceVectorSchema,
  effect: resourceVectorSchema,
  explanation: z.string().min(1),
})

export const gameContentShapeSchema = z.object({
  cards: z.array(cardSchema),
  board: z.array(boardSpaceSchema),
  managementActions: z.array(managementActionSchema),
})

export type CardCategory = (typeof cardCategories)[number]
export type BoardStage = (typeof boardStages)[number]
export type CardId = z.infer<typeof cardIdSchema>
export type CardOptionId = z.infer<typeof cardOptionIdSchema>
export type OutcomeId = z.infer<typeof outcomeIdSchema>
export type ResourceVector = z.infer<typeof resourceVectorSchema>
export type Outcome = z.infer<typeof outcomeSchema>
export type CardOption = z.infer<typeof cardOptionSchema>
export type Card = z.infer<typeof cardSchema>
export type BoardSpace = z.infer<typeof boardSpaceSchema>
export type ManagementAction = z.infer<typeof managementActionSchema>
export type GameContent = z.infer<typeof gameContentShapeSchema>
