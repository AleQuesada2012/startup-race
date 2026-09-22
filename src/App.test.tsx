import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('inicio de Startup Race', () => {
  it('presenta las entradas públicas para crear o unirse a un Room', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Startup Race' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear una sala' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Unirme con un código' }),
    ).toBeEnabled()
  })
})
