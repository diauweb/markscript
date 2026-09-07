export interface CardProps {
  /** Text displayed by the card. */
  title: string
  count?: number
}

/** Displays a typed document card. */
export function Card({title}: CardProps): string {
  return title
}
