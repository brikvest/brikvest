import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Users, Share2, Target, Clock, CheckCircle, Copy, Plus } from "lucide-react";
import type { Property, InvestmentGroup, GroupMember, InsertInvestmentGroup, JoinGroupData } from "@shared/schema";

export default function GroupInvestment() {
  const { toast } = useToast();
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [joinGroupModalOpen, setJoinGroupModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [groupDetailsModalOpen, setGroupDetailsModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<InvestmentGroup | null>(null);
  
  // Form states
  const [createGroupForm, setCreateGroupForm] = useState({
    groupName: "",
    description: "",
    leaderName: "",
    leaderEmail: "",
    leaderPhone: "",
    targetAmount: 0,
    targetUnits: 1,
    maxMembers: 5
  });

  const [joinGroupForm, setJoinGroupForm] = useState({
    inviteCode: "",
    fullName: "",
    email: "",
    phone: "",
    pledgedAmount: 0
  });

  // Fetch properties
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Fetch investment groups
  const { data: investmentGroups = [] } = useQuery<InvestmentGroup[]>({
    queryKey: ["/api/investment-groups"],
  });

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: async (data: InsertInvestmentGroup) => {
      return await apiRequest("/api/investment-groups", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: (group) => {
      toast({
        title: "Group Created Successfully!",
        description: `Your investment group "${group.groupName}" has been created. Share the invite code with friends.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-groups"] });
      setCreateGroupModalOpen(false);
      setCreateGroupForm({
        groupName: "",
        description: "",
        leaderName: "",
        leaderEmail: "",
        leaderPhone: "",
        targetAmount: 0,
        targetUnits: 1,
        maxMembers: 5
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create investment group. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Join group mutation
  const joinGroupMutation = useMutation({
    mutationFn: async (data: JoinGroupData) => {
      return await apiRequest("/api/investment-groups/join", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: (result) => {
      toast({
        title: "Joined Group Successfully!",
        description: `You've joined "${result.group.groupName}". You can now coordinate with other members.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-groups"] });
      setJoinGroupModalOpen(false);
      setJoinGroupForm({
        inviteCode: "",
        fullName: "",
        email: "",
        phone: "",
        pledgedAmount: 0
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to join investment group. Please check your invite code and try again.",
        variant: "destructive",
      });
    }
  });

  const handleCreateGroup = () => {
    if (!selectedProperty) return;

    const groupData: InsertInvestmentGroup = {
      propertyId: selectedProperty.id,
      groupName: createGroupForm.groupName,
      description: createGroupForm.description,
      leaderName: createGroupForm.leaderName,
      leaderEmail: createGroupForm.leaderEmail,
      leaderPhone: createGroupForm.leaderPhone,
      targetAmount: createGroupForm.targetAmount,
      targetUnits: createGroupForm.targetUnits,
      maxMembers: createGroupForm.maxMembers
    };

    createGroupMutation.mutate(groupData);
  };

  const handleJoinGroup = () => {
    const joinData: JoinGroupData = {
      inviteCode: joinGroupForm.inviteCode.toUpperCase(),
      fullName: joinGroupForm.fullName,
      email: joinGroupForm.email,
      phone: joinGroupForm.phone,
      pledgedAmount: joinGroupForm.pledgedAmount
    };

    joinGroupMutation.mutate(joinData);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: "Invite Code Copied",
      description: "Share this code with friends to invite them to your group.",
    });
  };

  const getGroupProgress = (group: InvestmentGroup) => {
    if (group.targetAmount === 0) return 0;
    return Math.round((group.currentAmount / group.targetAmount) * 100);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "recruiting": return "bg-blue-100 text-blue-800";
      case "funded": return "bg-green-100 text-green-800";
      case "confirmed": return "bg-purple-100 text-purple-800";
      case "closed": return "bg-gray-100 text-gray-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold text-slate-900">Group Investment</h1>
            <div className="flex gap-4">
              <Button onClick={() => setJoinGroupModalOpen(true)} variant="outline">
                <Users className="w-4 h-4 mr-2" />
                Join Group
              </Button>
              <Button onClick={() => setCreateGroupModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Group
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-50 to-slate-100 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-slate-900 mb-4">
            Invest Together with Friends
          </h2>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto mb-8">
            Pool resources with friends and family to secure premium property investments. 
            Lower individual commitments, shared decision-making, and collective success.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
            <div className="text-center">
              <div className="bg-blue-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Create or Join Groups</h3>
              <p className="text-slate-600">Start your own investment group or join friends in existing opportunities</p>
            </div>
            <div className="text-center">
              <div className="bg-green-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Target className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Pool Resources</h3>
              <p className="text-slate-600">Combine funds to reach investment targets and secure premium properties</p>
            </div>
            <div className="text-center">
              <div className="bg-purple-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Secure Slots Together</h3>
              <p className="text-slate-600">Reserve property slots as a group and contribute over time</p>
            </div>
          </div>
        </div>
      </section>

      {/* Active Investment Groups */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Active Investment Groups</h2>
            <p className="text-xl text-slate-600">Join these groups or create your own</p>
          </div>

          {investmentGroups.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-slate-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-600 mb-2">No Active Groups</h3>
              <p className="text-slate-500 mb-6">Be the first to create an investment group</p>
              <Button onClick={() => setCreateGroupModalOpen(true)}>
                Create First Group
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {investmentGroups.map((group) => {
                const property = properties.find(p => p.id === group.propertyId);
                const progress = getGroupProgress(group);
                
                return (
                  <Card key={group.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-4">
                      <div className="flex justify-between items-start mb-2">
                        <CardTitle className="text-lg">{group.groupName}</CardTitle>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(group.status)}`}>
                          {group.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">{property?.name}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm text-slate-600">Progress</span>
                            <span className="text-sm font-medium">{progress}%</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-slate-600">Target:</span>
                            <div className="font-semibold">{formatCurrency(group.targetAmount)}</div>
                          </div>
                          <div>
                            <span className="text-slate-600">Raised:</span>
                            <div className="font-semibold text-green-600">{formatCurrency(group.currentAmount)}</div>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2">
                          <div className="flex items-center text-sm text-slate-600">
                            <Users className="w-4 h-4 mr-1" />
                            <span>{group.maxMembers} max members</span>
                          </div>
                          <div className="flex items-center text-sm text-slate-600">
                            <Clock className="w-4 h-4 mr-1" />
                            <span>Expires {new Date(group.expiresAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <Button 
                            size="sm" 
                            className="flex-1"
                            onClick={() => {
                              setSelectedGroup(group);
                              setGroupDetailsModalOpen(true);
                            }}
                          >
                            View Details
                          </Button>
                          {group.status === 'recruiting' && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => copyInviteCode(group.inviteCode)}
                            >
                              <Share2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Create Group Modal */}
      <Dialog open={createGroupModalOpen} onOpenChange={setCreateGroupModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Investment Group</DialogTitle>
            <DialogDescription>
              Start a group to invest with friends and family. You'll be the group leader.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            {/* Property Selection */}
            <div>
              <Label htmlFor="property">Select Property</Label>
              <Select onValueChange={(value) => {
                const property = properties.find(p => p.id === parseInt(value));
                setSelectedProperty(property || null);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a property to invest in" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id.toString()}>
                      {property.name} - {formatCurrency(property.minInvestment)} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Group Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="groupName">Group Name</Label>
                <Input
                  id="groupName"
                  value={createGroupForm.groupName}
                  onChange={(e) => setCreateGroupForm({...createGroupForm, groupName: e.target.value})}
                  placeholder="e.g., Lagos Investment Club"
                />
              </div>
              <div>
                <Label htmlFor="maxMembers">Max Members</Label>
                <Select onValueChange={(value) => setCreateGroupForm({...createGroupForm, maxMembers: parseInt(value)})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select max members" />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 5, 8, 10, 15, 20].map((num) => (
                      <SelectItem key={num} value={num.toString()}>{num} members</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={createGroupForm.description}
                onChange={(e) => setCreateGroupForm({...createGroupForm, description: e.target.value})}
                placeholder="Describe the investment goals or strategy..."
              />
            </div>

            {/* Leader Information */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Your Information (Group Leader)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="leaderName">Full Name</Label>
                  <Input
                    id="leaderName"
                    value={createGroupForm.leaderName}
                    onChange={(e) => setCreateGroupForm({...createGroupForm, leaderName: e.target.value})}
                    placeholder="Your full name"
                  />
                </div>
                <div>
                  <Label htmlFor="leaderEmail">Email</Label>
                  <Input
                    id="leaderEmail"
                    type="email"
                    value={createGroupForm.leaderEmail}
                    onChange={(e) => setCreateGroupForm({...createGroupForm, leaderEmail: e.target.value})}
                    placeholder="your.email@example.com"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label htmlFor="leaderPhone">Phone Number</Label>
                <Input
                  id="leaderPhone"
                  value={createGroupForm.leaderPhone}
                  onChange={(e) => setCreateGroupForm({...createGroupForm, leaderPhone: e.target.value})}
                  placeholder="+234 XXX XXX XXXX"
                />
              </div>
            </div>

            {/* Investment Details */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Investment Target</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="targetAmount">Target Amount (₦)</Label>
                  <Input
                    id="targetAmount"
                    type="number"
                    value={createGroupForm.targetAmount}
                    onChange={(e) => setCreateGroupForm({...createGroupForm, targetAmount: parseInt(e.target.value) || 0})}
                    placeholder="5000000"
                  />
                </div>
                <div>
                  <Label htmlFor="targetUnits">Target Units</Label>
                  <Input
                    id="targetUnits"
                    type="number"
                    value={createGroupForm.targetUnits}
                    onChange={(e) => setCreateGroupForm({...createGroupForm, targetUnits: parseInt(e.target.value) || 1})}
                    placeholder="10"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <Button variant="outline" onClick={() => setCreateGroupModalOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreateGroup}
                disabled={!selectedProperty || !createGroupForm.groupName || !createGroupForm.leaderName || !createGroupForm.leaderEmail}
              >
                Create Group
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Join Group Modal */}
      <Dialog open={joinGroupModalOpen} onOpenChange={setJoinGroupModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Join Investment Group</DialogTitle>
            <DialogDescription>
              Enter the invite code shared by a group leader to join their investment group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="inviteCode">Invite Code</Label>
              <Input
                id="inviteCode"
                value={joinGroupForm.inviteCode}
                onChange={(e) => setJoinGroupForm({...joinGroupForm, inviteCode: e.target.value.toUpperCase()})}
                placeholder="Enter 6-digit code"
                maxLength={6}
              />
            </div>
            
            <div>
              <Label htmlFor="joinFullName">Full Name</Label>
              <Input
                id="joinFullName"
                value={joinGroupForm.fullName}
                onChange={(e) => setJoinGroupForm({...joinGroupForm, fullName: e.target.value})}
                placeholder="Your full name"
              />
            </div>
            
            <div>
              <Label htmlFor="joinEmail">Email</Label>
              <Input
                id="joinEmail"
                type="email"
                value={joinGroupForm.email}
                onChange={(e) => setJoinGroupForm({...joinGroupForm, email: e.target.value})}
                placeholder="your.email@example.com"
              />
            </div>
            
            <div>
              <Label htmlFor="joinPhone">Phone Number</Label>
              <Input
                id="joinPhone"
                value={joinGroupForm.phone}
                onChange={(e) => setJoinGroupForm({...joinGroupForm, phone: e.target.value})}
                placeholder="+234 XXX XXX XXXX"
              />
            </div>
            
            <div>
              <Label htmlFor="pledgedAmount">Your Pledged Amount (₦)</Label>
              <Input
                id="pledgedAmount"
                type="number"
                value={joinGroupForm.pledgedAmount}
                onChange={(e) => setJoinGroupForm({...joinGroupForm, pledgedAmount: parseInt(e.target.value) || 0})}
                placeholder="1000000"
              />
              <p className="text-sm text-slate-600 mt-1">
                Amount you commit to contribute to the group investment
              </p>
            </div>

            <div className="flex justify-end gap-4">
              <Button variant="outline" onClick={() => setJoinGroupModalOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleJoinGroup}
                disabled={!joinGroupForm.inviteCode || !joinGroupForm.fullName || !joinGroupForm.email || !joinGroupForm.pledgedAmount}
              >
                Join Group
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}