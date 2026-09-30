'use client';

import { useState } from 'react';
import { UserX } from 'lucide-react';

/**
 * A face image as a thumbnail, with a legible empty state.
 *
 * Shared by the attendance table, the notification bell and the employee list
 * so all three render "we have a picture" and "we do not" the same way.
 *
 * The empty state is a person icon rather than a blank box because it has two
 * real causes and both are worth seeing plainly: the capture never produced an
 * image, or the retention sweep cleared it after BIOMETRIC_RETENTION_DAYS. A
 * broken-image icon would suggest the dashboard is faulty when the record is
 * simply old.
 *
 * `src` is an inline `data:` URL rather than a link. The dashboard
 * authenticates with a Bearer token in localStorage, which an `<img src>` can
 * not send, so a URL would need a token in the query string or one blob fetch
 * per row -- hundreds of requests to render one page.
 */
export default function FaceThumb({
  src,
  name,
  size = 'md',
}: {
  src: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);

  const dimensions =
    size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-20 h-20' : 'w-11 h-11';
  const icon = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-8 h-8' : 'w-5 h-5';

  if (!src || failed) {
    return (
      <div
        className={`${dimensions} rounded-lg bg-silver-100 border border-silver-200 flex items-center justify-center shrink-0`}
        title="No face image on file"
      >
        <UserX className={`${icon} text-silver-700`} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a `data:` URL cannot
    // go through next/image (no loader can fetch it), and these are already
    // small pre-cropped JPEGs, so there is nothing to optimise.
    <img
      src={src}
      alt={`Face captured for ${name}`}
      onError={() => setFailed(true)}
      className={`${dimensions} rounded-lg object-cover border border-silver-200 shrink-0`}
    />
  );
}
