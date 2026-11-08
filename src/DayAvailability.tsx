import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { timeSlots } from './calendar';
import type { Locale } from './i18n';
import type { DayAvailability as AvailabilityRow, Group, ResponseValue } from './types';
import './day-availability.css';
import {PixelAvatar} from './Customization';

type SaveInput = { groupId: string; date: string; value: ResponseValue; time: string | null; note: string };
type Props = {
  locale: Locale;
  date: string;
  groups: Group[];
  initialGroupId?: string;
  userId: string;
  availability: AvailabilityRow[];
  busy: boolean;
  onSave: (input: SaveInput) => Promise<unknown>;
  onRemove: (groupId: string, date: string) => Promise<unknown>;
  onCreateGroup: () => void;
};

const copy = {
  en: {
    question: 'Are you free that day?', group: 'Group', yes: 'Yes', maybe: 'Not sure', no: 'No',
    hint: 'Your group can see your answer.', time: 'Time', optional: 'optional', anyTime: 'Any time',
    note: 'A little note', placeholder: 'After school / can bring snacks', save: 'Save my answer',
    update: 'Update my answer', saving: 'Saving…', clear: 'Clear my answer', clearing: 'Clearing…',
    replies: 'Group replies', empty: 'No replies yet. Share yours.', you: 'you', online: 'Online', away: 'Away', dnd:'Do not disturb', offline: 'Offline',
    groupRequired: 'Create or join a group to share your availability.', createGroup: 'Create a group',
    error: 'Couldn’t update your answer. Please try again.',
  },
  ru: {
    question: 'Получится в этот день?', group: 'Группа', yes: 'Да', maybe: 'Пока не знаю', no: 'Нет',
    hint: 'Участники группы увидят твой ответ.', time: 'Время', optional: 'необязательно', anyTime: 'В любое время',
    note: 'Пара слов', placeholder: 'После школы / могу принести перекус', save: 'Сохранить ответ',
    update: 'Обновить ответ', saving: 'Сохраняем…', clear: 'Убрать мой ответ', clearing: 'Убираем…',
    replies: 'Ответы группы', empty: 'Ответов пока нет. Начни первым!', you: 'ты', online: 'В сети', away: 'Отошёл', dnd:'Не беспокоить', offline: 'Не в сети',
    groupRequired: 'Создай группу или вступи в неё, чтобы поделиться своими планами.', createGroup: 'Создать группу',
    error: 'Не удалось обновить ответ. Попробуй ещё раз.',
  },
  de: {
    question: 'Hast du an diesem Tag Zeit?', group: 'Gruppe', yes: 'Ja', maybe: 'Noch offen', no: 'Nein',
    hint: 'Deine Gruppe kann deine Antwort sehen.', time: 'Uhrzeit', optional: 'optional', anyTime: 'Jederzeit',
    note: 'Eine kleine Notiz', placeholder: 'Nach der Schule / kann Snacks mitbringen', save: 'Antwort speichern',
    update: 'Antwort aktualisieren', saving: 'Wird gespeichert…', clear: 'Meine Antwort löschen', clearing: 'Wird gelöscht…',
    replies: 'Antworten der Gruppe', empty: 'Noch keine Antworten. Mach den Anfang!', you: 'du', online: 'Online', away: 'Abwesend', dnd:'Nicht stören', offline: 'Offline',
    groupRequired: 'Erstelle eine Gruppe oder tritt einer bei, um deine Verfügbarkeit zu teilen.', createGroup: 'Gruppe erstellen',
    error: 'Deine Antwort konnte nicht aktualisiert werden. Versuche es erneut.',
  },
  fr: {
    question: 'Tu es disponible ce jour-là ?', group: 'Groupe', yes: 'Oui', maybe: 'À confirmer', no: 'Non',
    hint: 'Ton groupe peut voir ta réponse.', time: 'Heure', optional: 'facultatif', anyTime: 'À toute heure',
    note: 'Un petit mot', placeholder: 'Après les cours / je peux apporter un goûter', save: 'Enregistrer ma réponse',
    update: 'Modifier ma réponse', saving: 'Enregistrement…', clear: 'Effacer ma réponse', clearing: 'Suppression…',
    replies: 'Réponses du groupe', empty: 'Pas encore de réponse. À toi de commencer !', you: 'toi', online: 'En ligne', away: 'Absent', dnd:'Ne pas déranger', offline: 'Hors ligne',
    groupRequired: 'Crée un groupe ou rejoins-en un pour partager tes disponibilités.', createGroup: 'Créer un groupe',
    error: 'Impossible de modifier ta réponse. Réessaie.',
  },
};

function AnswerIcon({ value }: { value: ResponseValue }) {
  return value === 'yes' ? <Check size={17} aria-hidden="true" />
    : value === 'no' ? <X size={17} aria-hidden="true" />
      : <span className="day-answer-question" aria-hidden="true">?</span>;
}

function AvailabilityEditor({ locale, date, groupId, existing, busy, onSave, onRemove }: {
  locale: Locale; date: string; groupId: string; existing?: AvailabilityRow; busy: boolean;
  onSave: Props['onSave']; onRemove: Props['onRemove'];
}) {
  const t = copy[locale];
  const [value, setValue] = useState<ResponseValue | null>(existing?.value ?? null);
  const [time, setTime] = useState(existing?.time ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [pending, setPending] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const hintId = useId();
  const locked = busy || pending !== null;

  // Shared updates may arrive while someone is typing. Keep their draft intact.
  useEffect(() => {
    if (dirty.current) return;
    setValue(existing?.value ?? null);
    setTime(existing?.time ?? '');
    setNote(existing?.note ?? '');
  }, [existing?.value, existing?.time, existing?.note, existing?.updatedAt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || value === null) return;
    setPending('save');
    setError('');
    try {
      const trimmedNote = note.trim();
      const result = await onSave({ groupId, date, value, time: value === 'no' ? null : time || null, note: trimmedNote });
      if (result !== false) {
        dirty.current = false;
        setNote(trimmedNote);
        if (value === 'no') setTime('');
      }
    } catch {
      setError(t.error);
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (locked || !existing) return;
    setPending('remove');
    setError('');
    try {
      const result = await onRemove(groupId, date);
      if (result !== false) {
        dirty.current = false;
        setValue(null);
        setTime('');
        setNote('');
      }
    } catch {
      setError(t.error);
    } finally {
      setPending(null);
    }
  }

  return <form className="day-availability-form" onSubmit={event => void submit(event)} aria-busy={locked}>
    <fieldset className="day-answer-fieldset" disabled={locked} aria-describedby={hintId}>
      <legend>{t.question}</legend>
      <div className="day-answer-choices">
        {(['yes', 'maybe', 'no'] as const).map(choice => <button
          key={choice} type="button" className={`day-answer-choice day-answer-${choice} ${value === choice ? 'is-selected' : ''}`}
          aria-pressed={value === choice} onClick={() => {
            dirty.current = true;
            setValue(choice);
            if (choice === 'no') setTime('');
            setError('');
          }}>
          <span className="day-answer-symbol"><AnswerIcon value={choice} /></span><span>{t[choice]}</span>
        </button>)}
      </div>
    </fieldset>
    <p className="day-availability-hint" id={hintId}>{t.hint}</p>
    <label className="field day-availability-time">
      <span>{t.time}<small>{t.optional}</small></span>
      <select value={time} disabled={locked || value === 'no'} onChange={event => {
        dirty.current = true; setTime(event.target.value); setError('');
      }}>
        <option value="">{t.anyTime}</option>
        {timeSlots.map(slot => <option value={slot} key={slot}>{slot}</option>)}
      </select>
      <small className="day-availability-range">08:00–20:00</small>
    </label>
    <label className="field day-availability-note">
      <span>{t.note}<small>{t.optional}</small></span>
      <textarea rows={2} maxLength={280} value={note} disabled={locked} placeholder={t.placeholder}
        onChange={event => { dirty.current = true; setNote(event.target.value); setError(''); }} />
    </label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button type="submit" className="button primary full day-availability-save" disabled={locked || value === null}>
      <Save size={16} aria-hidden="true" />{pending === 'save' ? t.saving : existing ? t.update : t.save}
    </button>
    {existing && <button type="button" className="day-availability-clear" disabled={locked} onClick={() => void remove()}>
      <Trash2 size={14} aria-hidden="true" />{pending === 'remove' ? t.clearing : t.clear}
    </button>}
  </form>;
}

export default function DayAvailabilityForm({
  locale, date, groups, initialGroupId, userId, availability, busy, onSave, onRemove, onCreateGroup,
}: Props) {
  const t = copy[locale];
  const [chosenGroupId, setChosenGroupId] = useState(() =>
    groups.some(group => group.id === initialGroupId) ? initialGroupId! : groups[0]?.id ?? '');
  const group = groups.find(item => item.id === chosenGroupId)
    ?? groups.find(item => item.id === initialGroupId) ?? groups[0];
  const repliesHeadingId = useId();

  if (!group) return <div className="modal-content day-availability day-availability-empty">
    <span className="day-availability-empty-icon" aria-hidden="true"><Users size={25} /></span>
    <p>{t.groupRequired}</p>
    <button type="button" className="button primary full" disabled={busy} onClick={onCreateGroup}>
      <Plus size={17} aria-hidden="true" />{t.createGroup}
    </button>
  </div>;

  const dayRows = availability.filter(row => row.groupId === group.id && row.date === date);
  const own = dayRows.find(row => row.userId === userId);
  const order: Record<ResponseValue, number> = { yes: 0, maybe: 1, no: 2 };
  const replies = group.members.flatMap(member => {
    const answer = dayRows.find(row => row.userId === member.id);
    return answer ? [{ member, answer }] : [];
  }).sort((a, b) => order[a.answer.value] - order[b.answer.value] || a.member.name.localeCompare(b.member.name, locale));

  return <div className="modal-content day-availability">
    {groups.length > 1 ? <label className="field day-availability-group-select">
      <span>{t.group}</span>
      <select value={group.id} disabled={busy} onChange={event => setChosenGroupId(event.target.value)}>
        {groups.map(item => <option value={item.id} key={item.id}>{item.emoji} {item.name}</option>)}
      </select>
    </label> : <p className="day-availability-group"><span aria-hidden="true">{group.emoji}</span>{group.name}</p>}
    <AvailabilityEditor key={`${group.id}:${date}:${userId}`} locale={locale} date={date} groupId={group.id}
      existing={own} busy={busy} onSave={onSave} onRemove={onRemove} />
    <section className="day-availability-people" aria-labelledby={repliesHeadingId}>
      <div className="day-availability-people-heading">
        <h3 id={repliesHeadingId}>{t.replies}</h3><span>{replies.length.toString().padStart(2, '0')}</span>
      </div>
      {replies.length === 0 ? <p className="day-availability-no-replies">{t.empty}</p>
        : <ul>{replies.map(({ member, answer }) => <li key={member.id} className={`day-person day-person-${answer.value}`}>
          <span className="day-person-avatar" aria-hidden="true"><PixelAvatar avatar={member.avatar||'mint'} size={31}/></span>
          <div className="day-person-body">
            <div className="day-person-top"><strong>{member.name}</strong>
              {member.presence && <span className={`day-person-presence day-presence-${member.presence}`}
                role="img" aria-label={t[member.presence]} title={t[member.presence]} />}
              {member.id === userId && <small>{t.you}</small>}
            </div>
            <div className="day-person-answer"><AnswerIcon value={answer.value} /><span>{t[answer.value]}</span>
              {answer.value !== 'no' && <span className="day-person-time">{answer.time || t.anyTime}</span>}
            </div>
            {answer.note && <p className="day-person-note">{answer.note}</p>}
          </div>
        </li>)}</ul>}
    </section>
  </div>;
}
