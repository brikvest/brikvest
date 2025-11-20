import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, MapPin, RefreshCw, BarChart3, ArrowLeft, ExternalLink } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import brikvest_logo from "@/assets/brikvest-logo.png";
import { useToast } from "@/hooks/use-toast";

interface ChartData {
  labels: number[];
  values: number[];
}

interface HistoricalPricePoint {
  period: string;
  price: string;
  priceValue: number;
  change: string;
  changeValue: number;
}

interface GuzapeGraphData {
  priceChart: ChartData;
  indexChart: ChartData;
  historicalPrices: {
    lastMonth: {
      price: string;
      priceValue: number;
      change: string;
      changeValue: number;
    };
    sixMonths: HistoricalPricePoint;
    oneYear: HistoricalPricePoint;
    twoYears: HistoricalPricePoint;
  };
  scrapedAt: string;
}

export default function Insights() {
  const [selectedCity, setSelectedCity] = useState("guzape");
  const { toast } = useToast();

  // Fetch graph data for selected location
  const { data: graphData, isLoading } = useQuery<GuzapeGraphData>({
    queryKey: [`/api/scrape/${selectedCity}-graphs`],
    enabled: !!selectedCity,
  });

  // Mutation for refreshing market data
  const refreshMutation = useMutation({
    mutationFn: async () => {
      // Re-scrape the HTML first
      const response = await fetch(`/api/scrape/${selectedCity}-html?persist=1`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to refresh data');
      }
      // Wait for the response to complete
      await response.text();
      return { success: true };
    },
    onSuccess: () => {
      // Invalidate the cache to refetch
      queryClient.invalidateQueries({ queryKey: [`/api/scrape/${selectedCity}-graphs`] });
      toast({
        title: "Data refreshed",
        description: "Market insights have been updated with the latest data from PropertyPro.ng",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Refresh failed",
        description: error.message || "Could not fetch the latest market data. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link href="/">
                <img src={brikvest_logo} alt="Brikvest Logo" className="h-8 w-auto cursor-pointer" />
              </Link>
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Card className="border-slate-200">
            <CardContent className="p-12">
              <div className="animate-pulse space-y-6">
                <div className="h-8 bg-slate-200 rounded w-1/3"></div>
                <div className="h-64 bg-slate-100 rounded"></div>
                <div className="h-64 bg-slate-100 rounded"></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!graphData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link href="/">
                <img src={brikvest_logo} alt="Brikvest Logo" className="h-8 w-auto cursor-pointer" />
              </Link>
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <Card className="border-slate-200">
            <CardContent className="p-16 text-center">
              <BarChart3 className="h-16 w-16 text-slate-400 mx-auto mb-6" />
              <h3 className="text-2xl font-semibold text-slate-900 mb-4">No market data available</h3>
              <p className="text-slate-600 mb-8">
                Market insights for {selectedCity} are currently unavailable.
              </p>
              <Button 
                onClick={() => refreshMutation.mutate()} 
                disabled={refreshMutation.isPending}
                data-testid="button-load-insights"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                {refreshMutation.isPending ? 'Loading...' : 'Load Market Data'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Transform data for recharts
  const priceChartData = graphData.priceChart.labels.map((year, index) => ({
    year: year.toString(),
    price: graphData.priceChart.values[index],
  }));

  const indexChartData = graphData.indexChart.labels.map((year, index) => ({
    year: year.toString(),
    index: graphData.indexChart.values[index],
  }));

  // Format currency
  const formatPrice = (value: number) => {
    if (value >= 1e9) return `₦${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `₦${(value / 1e6).toFixed(0)}M`;
    return `₦${value.toLocaleString()}`;
  };

  const currentPrice = graphData.priceChart.values[graphData.priceChart.values.length - 1];
  const priceGrowth = graphData.indexChart.values[graphData.indexChart.values.length - 1];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/">
              <img src={brikvest_logo} alt="Brikvest Logo" className="h-8 w-auto cursor-pointer" />
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back-home">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-4">
            Market <span className="text-blue-600">Insights</span>
          </h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto">
            Real-time property market analysis to help you make informed investment decisions
          </p>
        </div>

        {/* City Selector */}
        <div className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-medium text-slate-700">Select Location:</span>
            <Select value={selectedCity} onValueChange={setSelectedCity}>
              <SelectTrigger className="w-48" data-testid="select-city">
                <SelectValue placeholder="Select city" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="guzape">Guzape, Abuja</SelectItem>
                <SelectItem value="jahi">Jahi, Abuja</SelectItem>
                <SelectItem value="lugbe">Lugbe, Abuja</SelectItem>
                <SelectItem value="maitama" disabled>Maitama, Abuja (Coming Soon)</SelectItem>
                <SelectItem value="lekki" disabled>Lekki, Lagos (Coming Soon)</SelectItem>
                <SelectItem value="ikoyi" disabled>Ikoyi, Lagos (Coming Soon)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-500">
              Last updated: {new Date(graphData.scrapedAt).toLocaleDateString()}
            </div>
            <Button 
              onClick={() => refreshMutation.mutate()} 
              disabled={refreshMutation.isPending}
              variant="outline"
              size="sm"
              data-testid="button-refresh-data"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
              {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Data'}
            </Button>
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="border-0 bg-white shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-600">Average Price</div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="text-3xl font-bold text-slate-900">{formatPrice(currentPrice)}</div>
              <div className="text-xs text-slate-500 mt-1">{selectedCity.charAt(0).toUpperCase() + selectedCity.slice(1)}, Abuja (2025)</div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-600">Price Growth</div>
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
              </div>
              <div className="text-3xl font-bold text-green-600">+{priceGrowth.toFixed(0)}%</div>
              <div className="text-xs text-slate-500 mt-1">Since 2019</div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-600">Market Status</div>
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <BarChart3 className="h-4 w-4 text-emerald-600" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900">Strong Growth</div>
              <div className="text-xs text-slate-500 mt-1">High demand area</div>
            </CardContent>
          </Card>
        </div>

        {/* Historical Price Data from PropertyPro */}
        <Card className="border-0 bg-white shadow-lg mb-8" data-testid="card-historical-prices">
          <CardHeader>
            <CardTitle className="text-xl">Historical Price Data</CardTitle>
            <p className="text-sm text-slate-600">Market price trends from PropertyPro.ng</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Last Month */}
              <div className="p-5 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl shadow-md hover:shadow-lg transition-shadow">
                <p className="text-xs font-medium text-slate-600 mb-2">Average Price Last Month</p>
                <h3 className="text-2xl font-bold text-slate-900 mb-1">{graphData.historicalPrices.lastMonth.price}</h3>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">Change:</span>
                  <span className="font-medium text-slate-700">{graphData.historicalPrices.lastMonth.change}</span>
                  <span className={`font-semibold ${graphData.historicalPrices.lastMonth.changeValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {graphData.historicalPrices.lastMonth.changeValue.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* 6 Months Ago */}
              <div className="p-5 bg-gradient-to-br from-emerald-50 to-slate-50 rounded-xl shadow-md hover:shadow-lg transition-shadow">
                <p className="text-xs font-medium text-slate-600 mb-2">{graphData.historicalPrices.sixMonths.period}</p>
                <h3 className="text-2xl font-bold text-slate-900 mb-1">{graphData.historicalPrices.sixMonths.price}</h3>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`font-semibold ${graphData.historicalPrices.sixMonths.changeValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {graphData.historicalPrices.sixMonths.changeValue >= 0 ? '+' : ''}{graphData.historicalPrices.sixMonths.change}
                  </span>
                </div>
              </div>

              {/* 1 Year Ago */}
              <div className="p-5 bg-gradient-to-br from-purple-50 to-slate-50 rounded-xl shadow-md hover:shadow-lg transition-shadow">
                <p className="text-xs font-medium text-slate-600 mb-2">{graphData.historicalPrices.oneYear.period}</p>
                <h3 className="text-2xl font-bold text-slate-900 mb-1">{graphData.historicalPrices.oneYear.price}</h3>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`font-semibold ${graphData.historicalPrices.oneYear.changeValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {graphData.historicalPrices.oneYear.changeValue >= 0 ? '+' : ''}{graphData.historicalPrices.oneYear.change}
                  </span>
                </div>
              </div>

              {/* 2 Years Ago */}
              <div className="p-5 bg-gradient-to-br from-orange-50 to-slate-50 rounded-xl shadow-md hover:shadow-lg transition-shadow">
                <p className="text-xs font-medium text-slate-600 mb-2">{graphData.historicalPrices.twoYears.period}</p>
                <h3 className="text-2xl font-bold text-slate-900 mb-1">{graphData.historicalPrices.twoYears.price}</h3>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`font-semibold ${graphData.historicalPrices.twoYears.changeValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {graphData.historicalPrices.twoYears.changeValue >= 0 ? '+' : ''}{graphData.historicalPrices.twoYears.change}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Price History Chart */}
        <Card className="border-0 bg-white shadow-lg mb-8" data-testid="card-price-history">
          <CardHeader>
            <CardTitle className="text-xl">Average Price History</CardTitle>
            <p className="text-sm text-slate-600">Property price trends in {selectedCity.charAt(0).toUpperCase() + selectedCity.slice(1)}, Abuja (2019-2025)</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={priceChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="year" 
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  tickFormatter={formatPrice}
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <Tooltip 
                  formatter={(value: number) => [formatPrice(value), "Average Price"]}
                  labelFormatter={(label) => `Year ${label}`}
                  contentStyle={{ 
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#2563eb" 
                  strokeWidth={3}
                  name="Average Price"
                  dot={{ fill: "#2563eb", r: 5 }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Index Growth Chart */}
        <Card className="border-0 bg-white shadow-lg" data-testid="card-index-growth">
          <CardHeader>
            <CardTitle className="text-xl">Price Index Growth</CardTitle>
            <p className="text-sm text-slate-600">Percentage change from 2019 baseline</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={indexChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="year"
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  tickFormatter={(value) => `${value}%`}
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <Tooltip 
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "Growth"]}
                  labelFormatter={(label) => `Year ${label}`}
                  contentStyle={{ 
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="index" 
                  stroke="#16a34a" 
                  strokeWidth={3}
                  name="Price Index"
                  dot={{ fill: "#16a34a", r: 5 }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Key Insights */}
            <div className="mt-6 p-6 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl shadow-md">
              <h4 className="font-semibold text-slate-900 mb-3 flex items-center">
                <TrendingUp className="h-5 w-5 mr-2 text-blue-600" />
                Key Investment Insights
              </h4>
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span><strong>{((priceGrowth) / 100).toFixed(1)}x</strong> price increase since 2019 - strong appreciation potential</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span>Current average: <strong>{formatPrice(currentPrice)}</strong> - premium location pricing</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span>Consistent upward trend indicates growing demand in {selectedCity.charAt(0).toUpperCase() + selectedCity.slice(1)} area</span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* PropertyPro Attribution */}
        <div className="mt-8 mb-12 text-center">
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-white rounded-full shadow-md">
            <span className="text-sm text-slate-600">Market data powered by</span>
            <a 
              href="https://propertypro.ng/index/sale/all/abuja/guzape" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 font-semibold hover:text-blue-700 flex items-center gap-1 transition-colors"
              data-testid="link-propertypro"
            >
              PropertyPro.ng
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-12 text-center bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 sm:p-12 text-white">
          <h2 className="text-3xl font-bold mb-4">Ready to Invest?</h2>
          <p className="text-lg mb-8 text-blue-100 max-w-2xl mx-auto">
            Start building your real estate portfolio with fractional ownership in verified properties
          </p>
          <Link href="/">
            <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50" data-testid="button-browse-properties">
              Browse Properties
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
