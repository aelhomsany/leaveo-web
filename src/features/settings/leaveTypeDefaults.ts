/**
 * Default presentation for a newly created Leave Type.
 *
 * These live outside the component because `<input type="color">` needs a concrete hex value at
 * runtime and cannot read a CSS custom property, while the project rule is that components carry
 * no colour literals. Keeping them here gives the create modal, the edit modal's fallbacks, and any
 * future consumer one source of truth instead of six inline literals.
 */
export const LEAVE_TYPE_DEFAULT_PRESENTATION: {
  color: string
  backgroundColor: string
  borderColor: string
  presenceType: 'WFH' | 'OFF'
} = {
  color: '#093C5D',
  backgroundColor: '#D6E8ED',
  borderColor: '#0E4F75',
  presenceType: 'OFF',
}
