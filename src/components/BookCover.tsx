import { useState } from 'react';
import { BookOpen } from 'lucide-react';

interface BookCoverProps {
  src: string;
  alt: string;
  title: string;
  category?: string;
  className?: string;
}

export function BookCover({ src, alt, title, category, className = '' }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col justify-between bg-gradient-to-br from-emerald-950 via-emerald-900 to-stone-900 p-4 text-white select-none ${className}`}
      >
        <div className="flex items-center justify-between text-[11px] font-mono text-emerald-200/80">
          <span>EST Fès</span>
          <BookOpen className="h-4 w-4 shrink-0" />
        </div>
        <div className="space-y-1">
          {category && (
            <p className="text-[11px] font-medium text-emerald-200/90 line-clamp-1">
              {category}
            </p>
          )}
          <p className="font-editorial text-sm font-semibold leading-snug line-clamp-3">
            {title}
          </p>
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover bg-stone-100 ${className}`}
    />
  );
}
