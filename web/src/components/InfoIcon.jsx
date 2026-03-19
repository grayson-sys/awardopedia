import tooltips from '../tooltips'
import './InfoIcon.css'

export default function InfoIcon({ field }) {
  const text = tooltips[field]
  if (!text) return null

  return (
    <span className="info-icon-wrapper">
      <span className="info-icon-trigger">&#9432;</span>
      <span className="info-icon-tooltip">{text}</span>
    </span>
  )
}
