import { describe, expect, it } from 'vitest';
import { buildMime, classifyReply, tagSubject, ticketIdFrom } from './gmail';

const decode = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));

describe('buildMime', () => {
  it('round-trips a UTF-8 subject, body and attachment', () => {
    const bytes = new TextEncoder().encode('<h1>Evidence é</h1>');
    const mime = buildMime({ from: 'me@example.com', to: ['abuse@host.example'], replyTo: 'me@example.com', subject: '[Veil VT-AB12] Removal – ñ', text: 'Hello\nline two é', attachment: { name: 'e.html', type: 'text/html', bytes } });
    const subject = mime.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)![1]!;
    expect(decode(subject)).toBe('[Veil VT-AB12] Removal – ñ');
    const boundary = mime.match(/boundary="([^"]+)"/)![1]!;
    const parts = mime.split(`--${boundary}`);
    expect(parts).toHaveLength(4);
    expect(decode(parts[1]!.split('\r\n\r\n')[1]!)).toBe('Hello\nline two é');
    expect(decode(parts[2]!.split('\r\n\r\n')[1]!)).toBe('<h1>Evidence é</h1>');
    expect(mime).toContain('To: abuse@host.example');
  });
  it('rejects bad recipients and header injection', () => {
    expect(() => buildMime({ from: 'me@example.com', to: [], subject: 's', text: 't' })).toThrow();
    expect(() => buildMime({ from: 'me@example.com', to: ['not an address'], subject: 's', text: 't' })).toThrow();
    const m = buildMime({ from: 'me@example.com', to: ['a@b.co'], subject: 'x\r\nBcc: evil@x.co', text: 't' });
    expect(m).not.toMatch(/^Bcc:/m);
  });
});

describe('ticket tags', () => {
  it('tags once and reads the id back', () => {
    const s = tagSubject('VT-7Q2K9', 'Removal request');
    expect(s).toBe('[Veil VT-7Q2K9] Removal request');
    expect(tagSubject('VT-7Q2K9', s)).toBe(s);
    expect(ticketIdFrom(`Re: ${s}`)).toBe('VT-7Q2K9');
    expect(ticketIdFrom('Re: hello')).toBeNull();
  });
});

describe('classifyReply', () => {
  const cases: Array<[string, string]> = [
    ['The reported content has been removed from our platform.', 'removed'],
    ['We have taken down the image you reported.', 'removed'],
    ['We removed the reported post for violating our policies.', 'removed'],
    ['The URL is no longer available on our service.', 'removed'],
    ['We have disabled access to the material identified in your notice.', 'removed'],
    ['The content was removed on 14 Nov.', 'removed'],
    ['We reviewed your report and found the content does not violate our Community Guidelines.', 'rejected'],
    ['This is not in violation of our terms.', 'rejected'],
    ['We are unable to take action on this report.', 'rejected'],
    ['Your request has been denied.', 'rejected'],
    ['Unfortunately we cannot remove this content.', 'rejected'],
    ['We decline your request because the notice is not valid.', 'rejected'],
    ["This isn't against our rules, so it will stay up.", 'rejected'],
    ['Please provide a government ID so we can verify your identity.', 'needs_info'],
    ['We need more information to process your request.', 'needs_info'],
    ['Could you send the exact URL of the image?', 'needs_info'],
    ['Your notice is an incomplete notice under 17 USC 512.', 'needs_info'],
    ['We need additional information before we can act.', 'needs_info'],
    ['We received your report and will review it shortly.', 'acknowledged'],
    ['Thank you for contacting Trust & Safety. Your case number is 88123.', 'acknowledged'],
    ['Your ticket ID is #5512. We are reviewing it.', 'acknowledged'],
    ['Thank you for your report. It is under review.', 'acknowledged'],
    // traps
    ['If the content has not been removed within 48 hours, reply to this email. We received your report.', 'acknowledged'],
    ['The image has not been removed yet; we are looking into it.', 'acknowledged'],
    ['If this has been removed already, ignore this message.', 'unknown'],
    ['Out of office: I am away until Monday.', 'unknown'],
    ['Delivery Status Notification (Failure)', 'unknown'],
    ['We have not removed the content because it does not violate our policy.', 'rejected'],
    ['We cannot take it down without more information. Please provide the URL.', 'needs_info'],
    ['Hello', 'unknown'],
  ];
  it.each(cases)('%s -> %s', (text, verdict) => expect(classifyReply('Re: [Veil VT-AB12] notice', text)).toBe(verdict));
});
