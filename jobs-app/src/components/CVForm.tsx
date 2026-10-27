import { useState, type FormEvent } from 'react'
import { CV_FILE_ACCEPT, validateCVFile } from '../lib/cvs'
import type { CVDraft } from '../types'

type CVFormProps = {
  initial: CVDraft
  title: string
  existingFilename: string | null
  busy: boolean
  error: string
  /** Company names already used in the workspace, offered as suggestions. */
  companySuggestions?: string[]
  onCancel: () => void
  onSave: (draft: CVDraft, file: File | null) => Promise<void>
}

export function CVForm({ initial, title, existingFilename, busy, error, companySuggestions = [], onCancel, onSave }: CVFormProps) {
  const [draft, setDraft] = useState(initial)
  const [file, setFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState('')

  async function chooseFile(nextFile: File | null) {
    setValidationError('')
    if (!nextFile) {
      setFile(null)
      return
    }
    try {
      const { extension } = validateCVFile(nextFile)
      setFile(nextFile)
      if (extension === 'txt' && !draft.plain_text.trim()) {
        const text = await nextFile.text()
        setDraft((current) => current.plain_text.trim() ? current : { ...current, plain_text: text })
      }
    } catch (caught) {
      setFile(null)
      setValidationError(caught instanceof Error ? caught.message : 'This file cannot be used.')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setValidationError('')
    if (!draft.name.trim()) {
      setValidationError('Give this CV a clear name.')
      return
    }
    if (!file && !existingFilename && !draft.plain_text.trim()) {
      setValidationError('Add a CV file or paste the CV text.')
      return
    }
    await onSave(draft, file)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
      <section className="modal cv-modal" role="dialog" aria-modal="true" aria-labelledby="cv-form-title">
        <header className="modal-header"><div><p className="eyebrow">Private CV library</p><h2 id="cv-form-title">{title}</h2></div><button className="icon-button" type="button" aria-label="Close" disabled={busy} onClick={onCancel}>×</button></header>
        <form className="job-form" onSubmit={(event) => void submit(event)}>
          <label>CV name<input required autoFocus value={draft.name} placeholder="Product Manager CV" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Target role<input value={draft.target_role} placeholder="Senior Product Manager" onChange={(event) => setDraft({ ...draft, target_role: event.target.value })} /></label>
          <label className="full">Tailored for company<input value={draft.tailored_company} list="cv-company-suggestions" autoComplete="off" placeholder="Optional company name" onChange={(event) => setDraft({ ...draft, tailored_company: event.target.value })} /><small>Leave this blank for a general CV.</small></label>
          <datalist id="cv-company-suggestions">{companySuggestions.map((name) => <option key={name} value={name} />)}</datalist>
          <label className="full">CV file<input type="file" accept={CV_FILE_ACCEPT} disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} /><small>{file ? `${file.name} will be uploaded.` : existingFilename ? `Current file: ${existingFilename}. Choose another file to replace it.` : 'PDF, DOC, DOCX, TXT, or RTF. Maximum 10 MB.'}</small></label>
          <label className="full">CV text<textarea rows={12} value={draft.plain_text} placeholder="Paste the CV text here to make it searchable and ready for later tailoring." onChange={(event) => setDraft({ ...draft, plain_text: event.target.value })} /><small>Text-only CVs are supported. TXT files are copied here automatically.</small></label>
          <label className="full">Notes<textarea rows={4} value={draft.notes} placeholder="When to use this version, strengths, or changes to make" onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
          {(validationError || error) && <div className="error-banner full" role="alert">{validationError || error}</div>}
          <div className="form-actions full"><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save CV'}</button></div>
        </form>
      </section>
    </div>
  )
}
