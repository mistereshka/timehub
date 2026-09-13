import type { ReactNode } from 'react'
import { Button, IconButton } from '@primer/react'
import { PlayIcon, SquareFillIcon } from '@primer/octicons-react'
import type { RunningTimer, Task } from '@shared/types'
import { formatClock } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useNow } from '../hooks'
import { useI18n } from '../i18n'

function RunningButton({ timer, block }: { timer: RunningTimer; block: boolean }): ReactNode {
  const now = useNow(1000)
  const { t } = useI18n()
  return (
    <Button
      size={block ? 'medium' : 'small'}
      block={block}
      variant="danger"
      leadingVisual={SquareFillIcon}
      onClick={() => void api.stopTimer()}
      aria-label={t('timer.stop')}
    >
      <span className="mono">{formatClock(now - timer.start)}</span>
    </Button>
  )
}

/** Start/stop a task's timer: a small play icon in lists, a full-width button on the task page. */
export function TimerButton({ task, full = false }: { task: Pick<Task, 'id'>; full?: boolean }): ReactNode {
  const { timer } = useApp()
  const { t } = useI18n()
  if (timer?.taskId === task.id) return <RunningButton timer={timer} block={full} />
  if (full) {
    return (
      <Button block leadingVisual={PlayIcon} onClick={() => void api.startTimer(task.id)}>
        {t('timer.start')}
      </Button>
    )
  }
  return <IconButton icon={PlayIcon} size="small" variant="invisible" aria-label={t('timer.start')} onClick={() => void api.startTimer(task.id)} />
}
