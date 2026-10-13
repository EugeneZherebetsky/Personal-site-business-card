import { REPLY_KIND_LABELS, storedReplyKind } from '../lib/gmailReplies'
import { formatDateTime } from '../lib/opportunities'
import type { EmailReply } from '../types'

/**
 * Messages detected on a Gmail thread, labelled by kind so an out-of-office
 * or a delivery failure is never mistaken for someone answering.
 */
export function ReplyList({ replies }: { replies: EmailReply[] }) {
  return (
    <ul className="reply-list">
      {replies.map((reply) => {
        const kind = storedReplyKind(reply)
        return (
          <li key={reply.id} className={`reply-${kind}`}>
            <span>
              <strong>{REPLY_KIND_LABELS[kind]}</strong> · {reply.from_address || 'Unknown sender'}{' '}
              · {formatDateTime(reply.received_at)}
            </span>
            <small>{reply.subject || 'No subject'}</small>
          </li>
        )
      })}
    </ul>
  )
}
