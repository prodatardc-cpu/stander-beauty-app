interface BrandMarkProps {
  className: string;
}

export const BrandMark = ({ className }: BrandMarkProps) => (
   <span className={`brand-mark ${className}`} aria-hidden="true">
    <img className="brand-mark-light" src="/logo1.png" alt="" />
    <img className="brand-mark-dark" src="/logo2.png" alt="" />
   </span>
);