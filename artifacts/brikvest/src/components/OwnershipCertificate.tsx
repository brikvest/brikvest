import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { Award, CheckCircle2 } from 'lucide-react';

interface CertificateData {
  certificateNumber: string;
  ownerName: string;
  propertyName: string;
  propertyLocation: string;
  spvName?: string | null;
  units: string | number;
  amount: string | number;
  currency: string;
  issuedAt: string | Date;
  verificationToken: string;
}

interface OwnershipCertificateProps {
  certificate: CertificateData;
  className?: string;
}

export function OwnershipCertificate({ certificate, className = '' }: OwnershipCertificateProps) {
  // Always use production URL for QR code verification so certificates work when scanned
  const verificationUrl = `https://www.brikvest.net/verify/${certificate.verificationToken}`;
  
  const getCurrencySymbol = (currency: string) => {
    switch (currency) {
      case 'NGN': return '₦';
      case 'USD': return '$';
      case 'EUR': return '€';
      case 'GBP': return '£';
      default: return currency;
    }
  };

  const formatAmount = (amount: string | number) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return num.toLocaleString();
  };

  const formatDate = (date: string | Date) => {
    return format(new Date(date), 'MMMM d, yyyy');
  };

  return (
    <div 
      id="ownership-certificate"
      className={`bg-white relative overflow-hidden ${className}`}
      style={{ 
        width: '800px', 
        minHeight: '600px',
        fontFamily: "'Georgia', 'Times New Roman', serif"
      }}
    >
      {/* Decorative Border */}
      <div className="absolute inset-0 border-[12px] border-double border-blue-600/30 m-3 pointer-events-none" />
      <div className="absolute inset-0 border-[3px] border-blue-700/50 m-6 pointer-events-none" />
      
      {/* Corner Decorations */}
      <div className="absolute top-8 left-8 w-16 h-16 border-l-4 border-t-4 border-blue-600/40" />
      <div className="absolute top-8 right-8 w-16 h-16 border-r-4 border-t-4 border-blue-600/40" />
      <div className="absolute bottom-8 left-8 w-16 h-16 border-l-4 border-b-4 border-blue-600/40" />
      <div className="absolute bottom-8 right-8 w-16 h-16 border-r-4 border-b-4 border-blue-600/40" />
      
      {/* Watermark */}
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
        <span className="text-[200px] font-bold text-slate-900 rotate-[-15deg]">BRIKVEST</span>
      </div>

      <div className="relative z-10 p-12 pt-10">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-wider text-slate-800" style={{ letterSpacing: '0.15em' }}>
              BRIKVEST
            </h1>
          </div>
          <p className="text-sm text-slate-500 tracking-widest uppercase">
            Real Estate Investment Platform
          </p>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <div className="inline-block">
            <Award className="w-12 h-12 mx-auto text-amber-600 mb-2" />
            <h2 className="text-2xl font-semibold text-slate-800 tracking-wide uppercase border-b-2 border-amber-600/30 pb-2">
              Certificate of Ownership
            </h2>
          </div>
        </div>

        {/* Certificate Number */}
        <div className="text-center mb-6">
          <span className="bg-gradient-to-r from-amber-50 via-amber-100 to-amber-50 px-6 py-2 rounded-full text-amber-800 font-mono text-lg font-semibold border border-amber-300">
            {certificate.certificateNumber}
          </span>
        </div>

        {/* Body Text */}
        <div className="text-center mb-8 px-12">
          <p className="text-slate-600 text-lg leading-relaxed mb-4">
            This is to certify that
          </p>
          <p className="text-3xl font-bold text-slate-800 mb-4 border-b-2 border-slate-200 pb-2 inline-block px-8">
            {certificate.ownerName}
          </p>
          <p className="text-slate-600 text-lg leading-relaxed">
            is the verified owner of fractional property investment in
          </p>
        </div>

        {/* Property Details */}
        <div className="bg-gradient-to-r from-slate-50 via-white to-slate-50 border border-slate-200 rounded-lg p-6 mb-8 mx-8">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-slate-500 uppercase tracking-wide mb-1">Property</p>
              <p className="text-xl font-semibold text-slate-800">{certificate.propertyName}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 uppercase tracking-wide mb-1">Location</p>
              <p className="text-xl font-semibold text-slate-800">{certificate.propertyLocation}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 uppercase tracking-wide mb-1">Units Owned</p>
              <p className="text-xl font-semibold text-amber-700">{certificate.units}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 uppercase tracking-wide mb-1">Investment Value</p>
              <p className="text-xl font-semibold text-emerald-700">
                {getCurrencySymbol(certificate.currency)}{formatAmount(certificate.amount)}
              </p>
            </div>
            {certificate.spvName && (
              <div className="col-span-2 border-t border-slate-200 pt-4 mt-2">
                <p className="text-sm text-slate-500 uppercase tracking-wide mb-1">SPV Entity</p>
                <p className="text-lg font-mono font-semibold text-blue-700">{certificate.spvName}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-end justify-between mx-8">
          {/* Date and Signature */}
          <div className="flex-1">
            <div className="mb-4">
              <p className="text-sm text-slate-500 uppercase tracking-wide mb-1">Date of Issue</p>
              <p className="text-lg font-semibold text-slate-700">{formatDate(certificate.issuedAt)}</p>
            </div>
            
            <div className="mt-8">
              <div className="w-48 border-t-2 border-slate-300 pt-2">
                <p className="text-sm text-slate-500">Authorized Signatory</p>
                <p className="font-semibold text-slate-700 mt-1" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                  Brikvest Management
                </p>
              </div>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center">
            <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-200">
              <QRCodeSVG 
                value={verificationUrl}
                size={100}
                level="H"
                includeMargin={false}
                bgColor="white"
                fgColor="#1e293b"
              />
            </div>
            <p className="text-xs text-slate-500 mt-2 text-center">Scan to verify</p>
          </div>
        </div>

        {/* Verification Badge */}
        <div className="absolute top-24 right-12 opacity-80">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">Verified</span>
          </div>
        </div>
      </div>

      {/* Bottom seal */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs text-slate-400">
        <span>Digitally secured by Brikvest</span>
        <span>•</span>
        <span>brikvest.net</span>
      </div>
    </div>
  );
}

export function CertificateDownloadButton({ certificateRef }: { certificateRef: React.RefObject<HTMLDivElement> }) {
  const handleDownload = async () => {
    if (!certificateRef.current) return;
    
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(certificateRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });
      
      const link = document.createElement('a');
      link.download = 'brikvest-ownership-certificate.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('Error generating certificate image:', error);
    }
  };

  return (
    <button
      onClick={handleDownload}
      className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
      data-testid="button-download-certificate"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Download Certificate
    </button>
  );
}
