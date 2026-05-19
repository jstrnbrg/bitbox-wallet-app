// SPDX-License-Identifier: Apache-2.0

import { forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/forms';
import { useCloud } from '../state/context';
import type { Contact } from '../state/types';
import style from './messages-tab.module.css';

type Props = {
  contact: Contact;
};

const formatTime = (ts: number) => {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

export const MessagesTab = forwardRef<HTMLTextAreaElement, Props>(({ contact }, ref) => {
  const { t } = useTranslation();
  const { messages, sendMessage, markMessageRead } = useCloud();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const thread = messages(contact.id);

  // Mark unread incoming messages as read when tab mounts.
  useEffect(() => {
    const unread = messages(contact.id).filter(m => m.from === 'them' && !m.readAt);
    unread.forEach(m => markMessageRead(m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id]);

  // Auto-scroll to bottom on mount and when thread grows.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread.length]);

  const handleSend = () => {
    const body = draft.trim();
    if (!body) {
      return;
    }
    sendMessage(contact.id, body);
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={style.tab}>
      <div className={style.encInfo}>
        {t('cloud.contacts.messages.encryptedNote', { name: contact.name })}
      </div>
      <div
        className={[style.thread, thread.length === 0 ? style.threadEmpty : ''].filter(Boolean).join(' ')}
        ref={scrollRef}>
        {thread.length === 0 && (
          <div className={style.empty}>{t('cloud.contacts.messages.empty')}</div>
        )}
        {thread.map(m => (
          <div
            key={m.id}
            className={[
              style.bubbleRow,
              m.from === 'me' ? style.bubbleRowMe : style.bubbleRowThem,
            ].join(' ')}>
            <div
              className={[
                style.bubble,
                m.from === 'me' ? style.bubbleMe : style.bubbleThem,
              ].join(' ')}>
              <div className={style.bubbleBody}>{m.body}</div>
            </div>
            <div className={style.bubbleMeta}>{formatTime(m.sentAt)}</div>
          </div>
        ))}
      </div>
      <div className={style.composer}>
        <textarea
          ref={ref}
          className={style.composerInput}
          placeholder={t('cloud.contacts.messages.composePlaceholder')}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
        <Button
          primary
          className={style.sendButton}
          onClick={handleSend}
          disabled={!draft.trim()}>
          {t('cloud.contacts.messages.send')}
        </Button>
      </div>
    </div>
  );
});

MessagesTab.displayName = 'MessagesTab';
