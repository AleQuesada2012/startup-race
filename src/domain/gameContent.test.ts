import { describe, expect, it } from 'vitest'

import type { CardCategory } from './contentTypes'
import { gameContent, validateGameContent } from './gameContent'

const cloneContent = () => structuredClone(gameContent)

describe('game content contract', () => {
  it('accepts the authored 31-space board and 24-card catalog', () => {
    const content = validateGameContent(gameContent)

    expect(content.board).toHaveLength(31)
    expect(content.cards).toHaveLength(24)
    expect(content.managementActions).toHaveLength(3)
    expect(
      Object.fromEntries(
        ['decision', 'innovation', 'opportunity', 'crisis'].map((category) => [
          category,
          content.cards.filter((card) => card.category === category).length,
        ]),
      ),
    ).toEqual({ decision: 6, innovation: 6, opportunity: 6, crisis: 6 })
  })

  it('maps every card category to the fixed board positions', () => {
    const content = validateGameContent(gameContent)
    const positionsFor = (category: CardCategory) =>
      content.board
        .filter((space) => space.category === category)
        .map((space) => space.position)

    expect(positionsFor('decision')).toEqual([1, 5, 9, 13, 17, 21, 25, 29])
    expect(positionsFor('innovation')).toEqual([2, 7, 10, 15, 19, 22, 27])
    expect(positionsFor('opportunity')).toEqual([3, 6, 11, 14, 18, 23, 26])
    expect(positionsFor('crisis')).toEqual([4, 8, 12, 16, 20, 24, 28])
    expect(content.board[0]).toMatchObject({
      stage: 'idea',
      category: null,
      cardId: null,
    })
    expect(content.board[30]).toMatchObject({
      stage: 'company',
      category: null,
      cardId: null,
    })
  })

  it('publishes usable choices, costs, probabilities, and educational copy', () => {
    const content = validateGameContent(gameContent)

    for (const card of content.cards) {
      expect(card.options.length).toBeGreaterThanOrEqual(2)
      expect(card.options.length).toBeLessThanOrEqual(3)
      expect(card.learning.length).toBeGreaterThan(20)
      expect(card.options.filter((option) => option.isDefault)).toHaveLength(1)
      expect(
        card.options.filter(
          ({ cost }) =>
            cost.capital === 0 &&
            cost.reputation === 0 &&
            cost.innovation === 0,
        ),
      ).toHaveLength(1)

      for (const option of card.options) {
        expect(option.cost).toEqual({
          capital: expect.any(Number),
          reputation: expect.any(Number),
          innovation: expect.any(Number),
        })
        expect(
          option.outcomes.reduce(
            (total, outcome) => total + outcome.probability,
            0,
          ),
        ).toBe(100)
        expect(
          option.outcomes.every((outcome) => outcome.explanation.length > 20),
        ).toBe(true)
      }
    }
  })

  it('rejects an incomplete card catalog', () => {
    const content = cloneContent()
    content.cards.pop()

    expect(() => validateGameContent(content)).toThrow(
      'The catalog must contain exactly 24 cards',
    )
  })

  it('rejects invalid board coverage', () => {
    const content = cloneContent()
    content.board[1]!.category = 'crisis'

    expect(() => validateGameContent(content)).toThrow(
      'Board position 1 has invalid stage or card coverage',
    )
  })

  it('rejects omitted or tripled cards even when repeat counts look valid', () => {
    const content = cloneContent()
    content.board[13]!.cardId = content.cards.find(
      ({ id }) => id === 'decision-focus',
    )!.id
    content.board[17]!.cardId = content.cards.find(
      ({ id }) => id === 'decision-partner',
    )!.id

    expect(() => validateGameContent(content)).toThrow(
      'Every decision card must appear once',
    )
  })

  it('rejects a card without exactly one free default', () => {
    const content = cloneContent()
    content.cards[0]!.options[1]!.cost = {
      capital: 0,
      reputation: 0,
      innovation: 0,
    }

    expect(() => validateGameContent(content)).toThrow(
      'Each card needs exactly one free default option',
    )
  })

  it('rejects outcome weights that do not total 100%', () => {
    const content = cloneContent()
    content.cards[0]!.options[0]!.outcomes[0]!.probability = 64

    expect(() => validateGameContent(content)).toThrow(
      'Outcome probabilities must total 100%',
    )
  })

  it('rejects duplicate or modified Empresa management actions', () => {
    const duplicate = cloneContent()
    duplicate.managementActions[1] = structuredClone(
      duplicate.managementActions[0]!,
    )
    expect(() => validateGameContent(duplicate)).toThrow(
      'Empresa management actions must match the fixed contract',
    )

    const modified = cloneContent()
    modified.managementActions[0]!.effect.capital = 1999
    expect(() => validateGameContent(modified)).toThrow(
      'Empresa management actions must match the fixed contract',
    )
  })
})
