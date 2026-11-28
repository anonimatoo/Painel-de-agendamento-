import Link from 'next/link'
import { CalendarCheck } from 'lucide-react'
import styles from './public-experience.module.css'

export function PublicBrand() {
  return <Link className={styles.identity} href="/">
    <span className={styles.brandMark}><CalendarCheck aria-hidden /></span>
    <span>CS Agenda Pro</span>
  </Link>
}
