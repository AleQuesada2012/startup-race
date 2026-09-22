import { cards } from './cards'
import {
  cardIdSchema,
  cardCategories,
  gameContentShapeSchema,
  managementActionIds,
  type BoardSpace,
  type BoardStage,
  type CardCategory,
  type CardId,
  type GameContent,
  type ManagementAction,
} from './contentTypes'

const cardPositions: Record<CardCategory, readonly number[]> = {
  decision: [1, 5, 9, 13, 17, 21, 25, 29],
  innovation: [2, 7, 10, 15, 19, 22, 27],
  opportunity: [3, 6, 11, 14, 18, 23, 26],
  crisis: [4, 8, 12, 16, 20, 24, 28],
}

const cardByPosition: Record<number, string> = {
  1: 'decision-focus',
  2: 'innovation-prototype',
  3: 'opportunity-fair',
  4: 'crisis-competitor',
  5: 'decision-pricing',
  6: 'opportunity-mentor',
  7: 'innovation-automation',
  8: 'crisis-outage',
  9: 'decision-partner',
  10: 'innovation-patent',
  11: 'opportunity-grant',
  12: 'crisis-cashflow',
  13: 'decision-investor',
  14: 'opportunity-referral',
  15: 'innovation-data',
  16: 'crisis-review',
  17: 'decision-build-buy',
  18: 'opportunity-corporate',
  19: 'innovation-accessibility',
  20: 'crisis-supplier',
  21: 'decision-hire',
  22: 'innovation-pivot',
  23: 'opportunity-community',
  24: 'crisis-team',
  25: 'decision-focus',
  26: 'opportunity-fair',
  27: 'innovation-prototype',
  28: 'crisis-competitor',
  29: 'decision-pricing',
}

const stageAt = (position: number): BoardStage => {
  if (position === 0) return 'idea'
  if (position <= 7) return 'validation'
  if (position <= 14) return 'prototype'
  if (position <= 21) return 'launch'
  if (position <= 29) return 'growth'
  return 'company'
}

const categoryAt = (position: number): CardCategory | null =>
  cardCategories.find((category) =>
    cardPositions[category].includes(position),
  ) ?? null

const board: BoardSpace[] = Array.from({ length: 31 }, (_, position) => ({
  position,
  stage: stageAt(position),
  category: categoryAt(position),
  cardId: cardByPosition[position]
    ? cardIdSchema.parse(cardByPosition[position])
    : null,
}))

const managementActionContract = {
  financing: {
    cost: { capital: 0, reputation: 0, innovation: 0 },
    effect: { capital: 2000, reputation: 0, innovation: 0 },
  },
  product_improvement: {
    cost: { capital: 1000, reputation: 0, innovation: 0 },
    effect: { capital: 0, reputation: 0, innovation: 1 },
  },
  brand_building: {
    cost: { capital: 1000, reputation: 0, innovation: 0 },
    effect: { capital: 0, reputation: 1, innovation: 0 },
  },
} as const satisfies Record<
  (typeof managementActionIds)[number],
  Pick<ManagementAction, 'cost' | 'effect'>
>

const managementActions: ManagementAction[] = [
  {
    id: 'financing',
    label: 'Buscar financiamiento',
    ...managementActionContract.financing,
    explanation:
      'El financiamiento aporta capital para seguir operando, pero no sustituye los recursos necesarios para consolidar.',
  },
  {
    id: 'product_improvement',
    label: 'Mejorar el producto',
    ...managementActionContract.product_improvement,
    explanation:
      'Reinvertir en el producto transforma capital disponible en capacidad de innovación.',
  },
  {
    id: 'brand_building',
    label: 'Fortalecer la marca',
    ...managementActionContract.brand_building,
    explanation:
      'Una inversión de marca coherente aumenta la confianza y la reputación del emprendimiento.',
  },
]

const contentSchema = gameContentShapeSchema.superRefine((content, context) => {
  if (content.cards.length !== 24) {
    context.addIssue({
      code: 'custom',
      path: ['cards'],
      message: 'The catalog must contain exactly 24 cards',
    })
  }

  for (const category of cardCategories) {
    const categoryCards = content.cards.filter(
      (card) => card.category === category,
    )
    if (categoryCards.length !== 6) {
      context.addIssue({
        code: 'custom',
        path: ['cards'],
        message: `Category ${category} must contain exactly six cards`,
      })
    }
  }

  const cardIds = new Set(content.cards.map((card) => card.id))
  if (cardIds.size !== content.cards.length) {
    context.addIssue({
      code: 'custom',
      path: ['cards'],
      message: 'Card IDs must be unique',
    })
  }

  content.cards.forEach((card, cardIndex) => {
    const optionIds = new Set(card.options.map((option) => option.id))
    if (optionIds.size !== card.options.length) {
      context.addIssue({
        code: 'custom',
        path: ['cards', cardIndex, 'options'],
        message: 'Option IDs must be unique within a card',
      })
    }

    const defaultOptions = card.options.filter((option) => option.isDefault)
    const freeOptions = card.options.filter(
      ({ cost }) =>
        cost.capital === 0 && cost.reputation === 0 && cost.innovation === 0,
    )
    if (
      defaultOptions.length !== 1 ||
      freeOptions.length !== 1 ||
      defaultOptions[0]?.id !== freeOptions[0]?.id
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cards', cardIndex, 'options'],
        message: 'Each card needs exactly one free default option',
      })
    }

    card.options.forEach((option, optionIndex) => {
      const total = option.outcomes.reduce(
        (sum, outcome) => sum + outcome.probability,
        0,
      )
      if (total !== 100) {
        context.addIssue({
          code: 'custom',
          path: ['cards', cardIndex, 'options', optionIndex, 'outcomes'],
          message: 'Outcome probabilities must total 100%',
        })
      }
    })
  })

  if (
    content.board.length !== 31 ||
    content.board.some((space, index) => space.position !== index)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['board'],
      message: 'The board must contain ordered positions 0 through 30',
    })
  }

  const cardsById = new Map(content.cards.map((card) => [card.id, card]))
  content.board.forEach((space, index) => {
    const expectedCategory = categoryAt(index)
    const cardForSpace = space.cardId ? cardsById.get(space.cardId) : null
    if (
      space.stage !== stageAt(index) ||
      space.category !== expectedCategory ||
      (expectedCategory === null && space.cardId !== null) ||
      (expectedCategory !== null && cardForSpace?.category !== expectedCategory)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['board', index],
        message: `Board position ${index} has invalid stage or card coverage`,
      })
    }
  })

  const usage = new Map<CardId, number>()
  content.board.forEach(({ cardId }) => {
    if (cardId) usage.set(cardId, (usage.get(cardId) ?? 0) + 1)
  })
  for (const category of cardCategories) {
    const categoryCards = content.cards.filter(
      (card) => card.category === category,
    )
    const repeated = categoryCards.filter(
      (card) => (usage.get(card.id) ?? 0) === 2,
    )
    const expectedRepeats = category === 'decision' ? 2 : 1
    const everyCardHasValidUsage = categoryCards.every((card) => {
      const count = usage.get(card.id) ?? 0
      return count === 1 || count === 2
    })
    if (repeated.length !== expectedRepeats || !everyCardHasValidUsage) {
      context.addIssue({
        code: 'custom',
        path: ['board'],
        message: `Every ${category} card must appear once, with exactly ${expectedRepeats} prescribed repeat(s) appearing twice`,
      })
    }
  }

  const actionIds = new Set(content.managementActions.map(({ id }) => id))
  const hasExactActions =
    content.managementActions.length === managementActionIds.length &&
    actionIds.size === managementActionIds.length &&
    managementActionIds.every((id) => actionIds.has(id)) &&
    content.managementActions.every((action) => {
      const expected = managementActionContract[action.id]
      return (
        action.cost.capital === expected.cost.capital &&
        action.cost.reputation === expected.cost.reputation &&
        action.cost.innovation === expected.cost.innovation &&
        action.effect.capital === expected.effect.capital &&
        action.effect.reputation === expected.effect.reputation &&
        action.effect.innovation === expected.effect.innovation
      )
    })
  if (!hasExactActions) {
    context.addIssue({
      code: 'custom',
      path: ['managementActions'],
      message: 'Empresa management actions must match the fixed contract',
    })
  }
})

export const gameContent: GameContent = {
  cards,
  board,
  managementActions,
}

export const validateGameContent = (content: unknown): GameContent =>
  contentSchema.parse(content)
