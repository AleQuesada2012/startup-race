import './App.css'

const journeyStops = [
  { boardPosition: 0, label: 'Idea' },
  { boardPosition: 1, label: 'Validación' },
  { boardPosition: 8, label: 'Prototipo' },
  { boardPosition: 15, label: 'Lanzamiento' },
  { boardPosition: 22, label: 'Crecimiento' },
] as const

function App() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Startup Race, inicio">
          <span aria-hidden="true">SR</span>
          Startup Race
        </a>
        <span className="status-badge">MVP académico</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">El juego de crear, decidir y crecer</p>
          <h1 id="hero-title">Startup Race</h1>
          <p className="lede">
            Convierte una idea en empresa. Toma decisiones, enfrenta crisis y
            reúne los recursos para consolidar tu emprendimiento antes que los
            demás.
          </p>
          <div className="actions" aria-label="Opciones para jugar">
            <button className="button primary" type="button">
              Crear una sala
            </button>
            <button className="button secondary" type="button">
              Unirme con un código
            </button>
          </div>
          <p className="player-note">Para 2–4 jugadores · Sin cuentas</p>
        </div>

        <div className="game-card" aria-label="Ruta de una partida">
          <div className="game-card-top">
            <span>Tu ruta emprendedora</span>
            <span aria-hidden="true">↗</span>
          </div>
          <ol className="stage-list">
            {journeyStops.map(({ boardPosition, label }) => (
              <li key={label}>
                <span className="stage-number">{boardPosition}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
          <div className="resource-row" aria-label="Recursos para consolidar">
            <span>Capital</span>
            <span>Reputación</span>
            <span>Innovación</span>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
