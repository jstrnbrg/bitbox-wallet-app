// SPDX-License-Identifier: Apache-2.0

import type { Contact, Message, PaymentReq } from '../state/types';

export type NotificationItem =
  | { id: string; kind: 'payment-request'; contact: Contact; request: PaymentReq }
  | { id: string; kind: 'unread-message'; contact: Contact; count: number };

type TGetNotificationItems = {
  contacts: Contact[];
  requests: PaymentReq[];
  messages: (contactId: string) => Message[];
};

export const getNotificationItems = ({
  contacts,
  requests,
  messages,
}: TGetNotificationItems): NotificationItem[] => {
  const contactsById = new Map(contacts.map(c => [c.id, c]));

  const pendingRequests: NotificationItem[] = requests
    .filter(r => r.status === 'pending' && r.direction === 'in')
    .flatMap(request => {
      const contact = contactsById.get(request.contactId);
      if (!contact) {
        return [];
      }
      return [{
        id: `request-${request.id}`,
        kind: 'payment-request' as const,
        contact,
        request,
      }];
    });

  const unreadMessages: NotificationItem[] = contacts
    .flatMap(contact => {
      const count = messages(contact.id).filter(m => m.from === 'them' && !m.readAt).length;
      if (count === 0) {
        return [];
      }
      return [{
        id: `message-${contact.id}`,
        kind: 'unread-message' as const,
        contact,
        count,
      }];
    });

  return [...pendingRequests, ...unreadMessages];
};
