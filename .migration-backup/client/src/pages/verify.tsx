import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Home, Shield, Building2, Calendar, Hash, User, MapPin } from "lucide-react";
import brikvest_logo from "@/assets/brikvest-logo.png";

interface VerificationData {
  verified: boolean;
  certificate: {
    certificateNumber: string;
    ownerName: string;
    propertyName: string;
    propertyLocation: string;
    units: number;
    amount: string;
    currency: string;
    issuedAt: string;
  } | null;
}

export default function CertificateVerification() {
  const [, params] = useRoute("/verify/:token");
  const token = params?.token;

  const { data, isLoading, error } = useQuery<VerificationData>({
    queryKey: [`/api/verify/certificate/${token}`],
    enabled: !!token,
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 text-center">
            <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Invalid Verification Link</h2>
            <p className="text-slate-600 mb-6">
              This verification link is missing required information.
            </p>
            <Link href="/">
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Home className="h-4 w-4 mr-2" />
                Return to Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-slate-600">Verifying certificate...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 text-center">
            <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Verification Failed</h2>
            <p className="text-slate-600 mb-6">
              Unable to verify this certificate. It may not exist or the link may be invalid.
            </p>
            <Link href="/">
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Home className="h-4 w-4 mr-2" />
                Return to Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data.verified || !data.certificate) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-red-200">
          <CardHeader className="text-center border-b bg-red-50">
            <div className="mx-auto mb-4">
              <img src={brikvest_logo} alt="Brikvest" className="h-10 mx-auto" />
            </div>
            <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <CardTitle className="text-red-700">Certificate Not Valid</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 text-center">
            <p className="text-slate-600 mb-6">
              This ownership certificate could not be verified. It may have been revoked or does not exist in our records.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-700">
                <strong>Warning:</strong> If you received this certificate from someone claiming ownership of a Brikvest property, please contact us immediately.
              </p>
            </div>
            <Link href="/">
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Home className="h-4 w-4 mr-2" />
                Return to Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cert = data.certificate;
  const formattedAmount = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: cert.currency || 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parseFloat(cert.amount));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <Link href="/">
            <img src={brikvest_logo} alt="Brikvest" className="h-12 mx-auto mb-2 cursor-pointer" />
          </Link>
          <p className="text-slate-600 text-sm">Certificate Verification System</p>
        </div>

        {/* Verification Success Card */}
        <Card className="border-green-200 shadow-lg overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-green-500 to-emerald-600 text-white text-center py-6">
            <div className="flex items-center justify-center gap-3 mb-2">
              <CheckCircle className="h-10 w-10" />
              <Shield className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl font-bold">Certificate Verified</CardTitle>
            <p className="text-green-100 mt-2">
              This ownership certificate is authentic and valid
            </p>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            {/* Certificate Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Hash className="h-5 w-5 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-slate-500">Certificate Number</p>
                    <p className="font-semibold text-slate-900" data-testid="text-certificate-number">
                      {cert.certificateNumber}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <User className="h-5 w-5 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-slate-500">Owner Name</p>
                    <p className="font-semibold text-slate-900" data-testid="text-owner-name">
                      {cert.ownerName}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-slate-500">Issue Date</p>
                    <p className="font-semibold text-slate-900" data-testid="text-issue-date">
                      {new Date(cert.issuedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Building2 className="h-5 w-5 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-slate-500">Property</p>
                    <p className="font-semibold text-slate-900" data-testid="text-property-name">
                      {cert.propertyName}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-slate-500">Location</p>
                    <p className="font-semibold text-slate-900" data-testid="text-property-location">
                      {cert.propertyLocation}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="h-5 w-5 flex items-center justify-center text-slate-400 mt-0.5">
                    <span className="text-sm font-bold">#</span>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Units Owned</p>
                    <p className="font-semibold text-slate-900" data-testid="text-units">
                      {cert.units} unit{cert.units > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Investment Amount */}
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-sm text-slate-500 text-center mb-1">Investment Value</p>
              <p className="text-2xl font-bold text-slate-900 text-center" data-testid="text-investment-amount">
                {formattedAmount}
              </p>
            </div>

            {/* Trust Badge */}
            <div className="flex items-center justify-center gap-2 text-green-600 bg-green-50 rounded-lg p-3 border border-green-200">
              <Shield className="h-5 w-5" />
              <span className="text-sm font-medium">
                Verified by Brikvest Blockchain Registry
              </span>
            </div>

            {/* Footer Note */}
            <p className="text-xs text-slate-500 text-center">
              This certificate was verified at {new Date().toLocaleString()}. 
              The information above reflects the ownership status at the time of issuance.
            </p>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="mt-6 text-center">
          <Link href="/">
            <Button variant="outline" className="mr-2">
              <Home className="h-4 w-4 mr-2" />
              Visit Brikvest
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
