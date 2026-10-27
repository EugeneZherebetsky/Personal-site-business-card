export const JOB_STATUSES = [
  'saved',
  'applied',
  'phone_screen',
  'interviewing',
  'assessment',
  'final_round',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'on_hold',
  'closed',
] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

export const STATUS_LABELS: Record<JobStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  phone_screen: 'Phone screen',
  interviewing: 'Interview',
  assessment: 'Assessment',
  final_round: 'Final round',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  on_hold: 'On hold',
  closed: 'Closed',
}

export const WORK_MODES = ['unspecified', 'remote', 'hybrid', 'onsite'] as const
export type WorkMode = (typeof WORK_MODES)[number]

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type JobPriority = (typeof PRIORITIES)[number]

export const APP_VIEWS = ['dashboard', 'board', 'applications', 'reminders', 'contacts', 'outreach', 'interviews', 'cvs', 'search', 'backup', 'settings'] as const
export type AppView = (typeof APP_VIEWS)[number]
export type DefaultView = Extract<AppView, 'dashboard' | 'board' | 'applications' | 'reminders' | 'cvs'>

export type Job = {
  id: string
  user_id: string
  company: string
  role_title: string
  status: JobStatus
  work_mode: WorkMode
  priority: JobPriority
  location: string | null
  job_url: string | null
  source: string | null
  salary_text: string | null
  contact_name: string | null
  contact_email: string | null
  applied_at: string | null
  next_action: string | null
  next_action_at: string | null
  job_description: string | null
  notes: string | null
  external_job_id: string | null
  email_recipient: string | null
  email_subject: string | null
  email_body: string | null
  cv_id: string | null
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
}

export type JobDraft = {
  company: string
  role_title: string
  status: JobStatus
  work_mode: WorkMode
  priority: JobPriority
  location: string
  job_url: string
  source: string
  salary_text: string
  contact_name: string
  contact_email: string
  applied_at: string
  next_action: string
  next_action_at: string
  job_description: string
  notes: string
  external_job_id: string
  email_recipient: string
  email_subject: string
  email_body: string
  cv_id: string
}

export type CV = {
  id: string
  user_id: string
  name: string
  storage_path: string | null
  target_role: string | null
  notes: string | null
  original_filename: string | null
  mime_type: string | null
  size_bytes: number | null
  plain_text: string | null
  tailored_company: string | null
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
}

export type CVDraft = {
  name: string
  target_role: string
  notes: string
  plain_text: string
  tailored_company: string
}

export type ApplicationSend = {
  id: string
  user_id: string
  job_id: string
  cv_id: string | null
  sent_at: string
  recipient: string
  subject: string
  provider: string
  provider_message_id: string | null
  status: 'sent' | 'failed'
  details: Record<string, unknown>
}

export type UserSettings = {
  user_id: string
  default_view: DefaultView
  reminders_enabled: boolean
  reminder_lead_hours: number
  timezone: string
  google_client_id: string | null
  email_reminders_enabled: boolean
  email_reminder_hour: number
  created_at: string
  updated_at: string
  version: number
}

export type SettingsDraft = Pick<UserSettings, 'default_view' | 'reminders_enabled' | 'reminder_lead_hours' | 'timezone' | 'email_reminders_enabled' | 'email_reminder_hour'> & {
  google_client_id: string
}

export type JobStageEvent = {
  id: string
  user_id: string
  job_id: string
  from_status: JobStatus | null
  to_status: JobStatus
  event_type: 'created' | 'status_change' | 'backfill_current_state'
  occurred_at: string
  details: Record<string, unknown>
}

export const CONTACT_RELATIONSHIPS = ['recruiter', 'referral', 'hiring_manager', 'colleague', 'friend', 'other'] as const
export type ContactRelationship = (typeof CONTACT_RELATIONSHIPS)[number]

export const RELATIONSHIP_LABELS: Record<ContactRelationship, string> = {
  recruiter: 'Recruiter',
  referral: 'Referral',
  hiring_manager: 'Hiring manager',
  colleague: 'Colleague',
  friend: 'Friend',
  other: 'Other',
}

export const CONTACT_STAGES = ['to_contact', 'contacted', 'in_conversation', 'meeting_scheduled', 'dormant', 'closed'] as const
export type ContactStage = (typeof CONTACT_STAGES)[number]

export const CONTACT_STAGE_LABELS: Record<ContactStage, string> = {
  to_contact: 'To contact',
  contacted: 'Contacted',
  in_conversation: 'In conversation',
  meeting_scheduled: 'Meeting scheduled',
  dormant: 'Dormant',
  closed: 'Closed',
}

export const INTERACTION_CHANNELS = ['email', 'call', 'linkedin', 'meeting', 'message', 'other'] as const
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number]

export const INTERACTION_CHANNEL_LABELS: Record<InteractionChannel, string> = {
  email: 'Email',
  call: 'Call',
  linkedin: 'LinkedIn',
  meeting: 'Meeting',
  message: 'Message',
  other: 'Other',
}

export type Contact = {
  id: string
  user_id: string
  name: string
  company: string | null
  role_title: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  relationship: ContactRelationship
  pipeline_stage: ContactStage
  job_id: string | null
  next_action: string | null
  next_action_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
  /** Derived client-side from the newest embedded interaction; never written to the database. */
  last_interaction_at: string | null
}

export type ContactDraft = {
  name: string
  company: string
  role_title: string
  email: string
  phone: string
  linkedin_url: string
  relationship: ContactRelationship
  pipeline_stage: ContactStage
  job_id: string
  next_action: string
  next_action_at: string
  notes: string
}

export type ContactInteraction = {
  id: string
  user_id: string
  contact_id: string
  occurred_at: string
  channel: InteractionChannel
  summary: string
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
}

export type InteractionDraft = {
  occurred_at: string
  channel: InteractionChannel
  summary: string
}

export type StarStory = {
  id: string
  user_id: string
  title: string
  situation: string | null
  task: string | null
  action: string | null
  result: string | null
  skills: string | null
  notes: string | null
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
}

export type StarStoryDraft = {
  title: string
  situation: string
  task: string
  action: string
  result: string
  skills: string
  notes: string
}

export const PREP_CHECKLIST: Array<{ key: string; label: string }> = [
  { key: 'research_company', label: 'Research the company, product, and recent news' },
  { key: 'reread_description', label: 'Re-read the job description and match your evidence' },
  { key: 'star_examples', label: 'Choose STAR examples for the likely topics' },
  { key: 'questions', label: 'Prepare questions to ask the interviewers' },
  { key: 'logistics', label: 'Confirm the time, video link or route, and interviewer names' },
  { key: 'cv_review', label: 'Re-read the CV version that was sent' },
  { key: 'salary', label: 'Prepare answers on salary expectations and availability' },
  { key: 'thank_you', label: 'Send a thank-you message after the interview' },
]

export type InterviewPrep = {
  id: string
  user_id: string
  job_id: string
  research_notes: string | null
  questions_to_ask: string | null
  checklist: Record<string, boolean>
  post_interview_notes: string | null
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
}

export type InterviewPrepDraft = {
  research_notes: string
  questions_to_ask: string
  checklist: Record<string, boolean>
  post_interview_notes: string
}

/**
 * Result of saving interview preparation: the new optimistic-lock baseline.
 * `null` means the save failed and the previous baseline should be kept;
 * `{ prep: null }` means the record no longer exists and the next save should insert.
 */
export type InterviewPrepSaveResult = { prep: InterviewPrep | null } | null

export const CV_BLOCK_TYPES = ['summary', 'skills', 'experience', 'achievement', 'education', 'certification', 'other'] as const
export type CVBlockType = (typeof CV_BLOCK_TYPES)[number]

export const CV_BLOCK_TYPE_LABELS: Record<CVBlockType, string> = {
  summary: 'Profile summary',
  skills: 'Skills',
  experience: 'Experience',
  achievement: 'Achievement',
  education: 'Education',
  certification: 'Certification',
  other: 'Other',
}

/** Order the assembled CV uses when grouping selected blocks. */
export const CV_BLOCK_TYPE_ORDER: CVBlockType[] = ['summary', 'skills', 'experience', 'achievement', 'education', 'certification', 'other']

export type CVBlock = {
  id: string
  user_id: string
  block_type: CVBlockType
  title: string
  content: string
  tags: string | null
  sort_order: number
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
}

export type CVBlockDraft = {
  block_type: CVBlockType
  title: string
  content: string
  tags: string
  sort_order: number
}

export const EMPTY_CV_BLOCK: CVBlockDraft = {
  block_type: 'achievement',
  title: '',
  content: '',
  tags: '',
  sort_order: 0,
}

export const EMPTY_CONTACT: ContactDraft = {
  name: '',
  company: '',
  role_title: '',
  email: '',
  phone: '',
  linkedin_url: '',
  relationship: 'recruiter',
  pipeline_stage: 'to_contact',
  job_id: '',
  next_action: '',
  next_action_at: '',
  notes: '',
}

export const EMPTY_STAR_STORY: StarStoryDraft = {
  title: '',
  situation: '',
  task: '',
  action: '',
  result: '',
  skills: '',
  notes: '',
}

export const EMPTY_INTERVIEW_PREP: InterviewPrepDraft = {
  research_notes: '',
  questions_to_ask: '',
  checklist: {},
  post_interview_notes: '',
}

export const EMPTY_JOB: JobDraft = {
  company: '',
  role_title: '',
  status: 'saved',
  work_mode: 'unspecified',
  priority: 'medium',
  location: '',
  job_url: '',
  source: '',
  salary_text: '',
  contact_name: '',
  contact_email: '',
  applied_at: '',
  next_action: '',
  next_action_at: '',
  job_description: '',
  notes: '',
  external_job_id: '',
  email_recipient: '',
  email_subject: '',
  email_body: '',
  cv_id: '',
}

export const EMPTY_CV: CVDraft = {
  name: '',
  target_role: '',
  notes: '',
  plain_text: '',
  tailored_company: '',
}

export const OUTREACH_STATUSES = ['draft', 'sending', 'sent', 'failed'] as const
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number]

export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  draft: 'Draft',
  sending: 'Outcome unknown',
  sent: 'Sent',
  failed: 'Failed',
}

export const REPLY_STATUSES = ['awaiting', 'replied', 'no_reply'] as const
export type ReplyStatus = (typeof REPLY_STATUSES)[number]

export const REPLY_STATUS_LABELS: Record<ReplyStatus, string> = {
  awaiting: 'Awaiting reply',
  replied: 'Replied',
  no_reply: 'No reply',
}

/**
 * A speculative email to a leader at a company of interest. Once `status` is
 * `sent` the delivered content is frozen by a database trigger; only the
 * outcome fields stay editable.
 */
export type OutreachEmail = {
  id: string
  user_id: string
  company: string
  recipient_name: string | null
  recipient_role: string | null
  recipient_email: string
  contact_id: string | null
  cv_id: string | null
  job_id: string | null
  subject: string
  body: string
  status: OutreachStatus
  sent_at: string | null
  send_attempt_id: string | null
  send_attempted_at: string | null
  provider: string
  provider_message_id: string | null
  provider_thread_id: string | null
  attachment_filename: string | null
  reply_status: ReplyStatus
  replied_at: string | null
  follow_up_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  version: number
  data: Record<string, unknown>
}

export type OutreachDraft = {
  company: string
  recipient_name: string
  recipient_role: string
  recipient_email: string
  contact_id: string
  cv_id: string
  subject: string
  body: string
  follow_up_at: string
  notes: string
}

export const EMPTY_OUTREACH: OutreachDraft = {
  company: '',
  recipient_name: '',
  recipient_role: '',
  recipient_email: '',
  contact_id: '',
  cv_id: '',
  subject: '',
  body: '',
  follow_up_at: '',
  notes: '',
}

/**
 * A message detected on a Gmail thread the user wrote on. Header facts only:
 * this app never requests or stores message bodies. `data.kind` says whether
 * it was a person replying, an automatic reply, or a delivery failure.
 */
export type EmailReply = {
  id: string
  user_id: string
  source_type: 'job' | 'outreach'
  source_id: string
  thread_id: string
  provider_message_id: string
  from_address: string | null
  subject: string | null
  received_at: string
  detected_at: string
  data: Record<string, unknown>
}
