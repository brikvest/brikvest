import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, Building, FileText, Calendar, Mail, Phone, MapPin } from "lucide-react";
import { Link } from "wouter";
import type { Property, InvestmentReservation, DeveloperBid } from "@shared/schema";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function AdminDashboard() {
  const [selectedTab, setSelectedTab] = useState("overview");

  // Fetch all data
  const { data: properties = [], isLoading: propertiesLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: developerBids = [], isLoading: bidsLoading } = useQuery<DeveloperBid[]>({
    queryKey: ["/api/developer-bids"],
  });

  // Calculate totals from all reservations
  const totalReservations = properties.reduce((acc, property) => {
    return acc + (property.totalSlots - property.availableSlots);
  }, 0);

  const totalInvestmentValue = properties.reduce((acc, property) => {
    const reservedSlots = property.totalSlots - property.availableSlots;
    return acc + (reservedSlots * property.minInvestment);
  }, 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-NG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <img 
                src={brikvest_logo} 
                alt="Brikvest Logo" 
                className="h-8 w-auto"
              />
              <span className="text-slate-400">|</span>
              <h1 className="text-xl font-semibold text-slate-700">Admin Dashboard</h1>
            </div>
            <Link href="/">
              <Button variant="outline" className="flex items-center space-x-2">
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Site</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="investments">Investments</TabsTrigger>
            <TabsTrigger value="developers">Developer Bids</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Properties</CardTitle>
                  <Building className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{properties.length}</div>
                  <p className="text-xs text-muted-foreground">Active listings</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Reservations</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalReservations}</div>
                  <p className="text-xs text-muted-foreground">Investment slots reserved</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Investment Value</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(totalInvestmentValue)}</div>
                  <p className="text-xs text-muted-foreground">Reserved investment amount</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Developer Bids</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{developerBids.length}</div>
                  <p className="text-xs text-muted-foreground">Pending review</p>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Property Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {properties.slice(0, 5).map((property) => (
                      <div key={property.id} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{property.name}</p>
                          <p className="text-sm text-muted-foreground">{property.location}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">{property.fundingProgress}% funded</p>
                          <p className="text-xs text-muted-foreground">
                            {property.totalSlots - property.availableSlots} / {property.totalSlots} slots
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Developer Bids</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {developerBids.slice(0, 5).map((bid) => (
                      <div key={bid.id} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{bid.companyName}</p>
                          <p className="text-sm text-muted-foreground">{bid.projectType}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant={bid.status === "pending" ? "secondary" : "default"}>
                            {bid.status}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(bid.createdAt.toString())}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Properties Tab */}
          <TabsContent value="properties">
            <Card>
              <CardHeader>
                <CardTitle>All Properties</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property Name</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Total Value</TableHead>
                      <TableHead>Min Investment</TableHead>
                      <TableHead>Funding Progress</TableHead>
                      <TableHead>Available Slots</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {properties.map((property) => (
                      <TableRow key={property.id}>
                        <TableCell className="font-medium">{property.name}</TableCell>
                        <TableCell>{property.location}</TableCell>
                        <TableCell>{formatCurrency(property.totalValue)}</TableCell>
                        <TableCell>{formatCurrency(property.minInvestment)}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-green-600 h-2 rounded-full" 
                                style={{ width: `${property.fundingProgress}%` }}
                              />
                            </div>
                            <span className="text-sm">{property.fundingProgress}%</span>
                          </div>
                        </TableCell>
                        <TableCell>{property.availableSlots} / {property.totalSlots}</TableCell>
                        <TableCell>
                          <Badge variant={property.status === "active" ? "default" : "secondary"}>
                            {property.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Investments Tab */}
          <TabsContent value="investments">
            <Card>
              <CardHeader>
                <CardTitle>Investment Reservations Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property</TableHead>
                      <TableHead>Reserved Slots</TableHead>
                      <TableHead>Total Reserved Value</TableHead>
                      <TableHead>Funding Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {properties.map((property) => {
                      const reservedSlots = property.totalSlots - property.availableSlots;
                      const reservedValue = reservedSlots * property.minInvestment;
                      return (
                        <TableRow key={property.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{property.name}</p>
                              <p className="text-sm text-muted-foreground">{property.location}</p>
                            </div>
                          </TableCell>
                          <TableCell>{reservedSlots} slots</TableCell>
                          <TableCell>{formatCurrency(reservedValue)}</TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div 
                                  className="bg-green-600 h-2 rounded-full" 
                                  style={{ width: `${property.fundingProgress}%` }}
                                />
                              </div>
                              <span className="text-sm">{property.fundingProgress}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Developer Bids Tab */}
          <TabsContent value="developers">
            <Card>
              <CardHeader>
                <CardTitle>Developer Bids</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {developerBids.map((bid) => (
                    <div key={bid.id} className="border rounded-lg p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-semibold">{bid.companyName}</h3>
                          <p className="text-sm text-muted-foreground">Contact: {bid.contactPerson}</p>
                        </div>
                        <Badge variant={bid.status === "pending" ? "secondary" : "default"}>
                          {bid.status}
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                        <div className="flex items-center space-x-2">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{bid.email}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Phone className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{bid.phone}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <MapPin className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{bid.location}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div>
                          <p className="text-sm font-medium">Project Type</p>
                          <p className="text-sm text-muted-foreground">{bid.projectType}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Project Value</p>
                          <p className="text-sm text-muted-foreground">{formatCurrency(bid.projectValue)}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Timeline</p>
                          <p className="text-sm text-muted-foreground">{bid.timeline} months</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-medium">Description</p>
                          <p className="text-sm text-muted-foreground">{bid.description}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Experience</p>
                          <p className="text-sm text-muted-foreground">{bid.experience}</p>
                        </div>
                      </div>

                      <div className="flex justify-between items-center mt-4 pt-4 border-t">
                        <p className="text-xs text-muted-foreground">
                          Submitted on {formatDate(bid.createdAt.toString())}
                        </p>
                        <div className="space-x-2">
                          <Button variant="outline" size="sm">Review</Button>
                          <Button size="sm">Contact</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {developerBids.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No developer bids submitted yet.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}