import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { RefreshCw, TrendingUp, BarChart3, ArrowLeft } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

interface ChartData {
  labels: number[];
  values: number[];
}

interface GuzapeGraphData {
  priceChart: ChartData;
  indexChart: ChartData;
  scrapedAt: string;
}

export default function GuzapeGraphsPage() {
  const { data: graphData, isLoading } = useQuery<GuzapeGraphData>({
    queryKey: ['/api/scrape/guzape-graphs'],
  });

  const handleRefresh = async () => {
    // Re-scrape the HTML first
    await fetch('/api/scrape/guzape-html?persist=1');
    // Then invalidate the cache to fetch new graph data
    queryClient.invalidateQueries({ queryKey: ['/api/scrape/guzape-graphs'] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading graph data...</p>
        </div>
      </div>
    );
  }

  if (!graphData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>No Graph Data</CardTitle>
            <CardDescription>
              The graph data hasn't been scraped yet. Click refresh to scrape PropertyPro.ng
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleRefresh} className="w-full" data-testid="button-refresh-graphs">
              <RefreshCw className="h-4 w-4 mr-2" />
              Scrape Graph Data
            </Button>
          </CardContent>
        </Card>
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

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <Link href="/guzape">
            <Button variant="ghost" size="sm" className="mb-2 -ml-2" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to HTML View
            </Button>
          </Link>
          <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">Guzape Market Analysis</h1>
          <p className="text-muted-foreground">
            Real estate price trends from PropertyPro.ng
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Last updated: {new Date(graphData.scrapedAt).toLocaleString()}
          </p>
        </div>
        <Button onClick={handleRefresh} variant="outline" data-testid="button-refresh-data">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Data
        </Button>
      </div>

      {/* Price Change Graph */}
      <Card className="mb-8" data-testid="card-price-chart">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <CardTitle>Average Price Trend (Guzape, Abuja)</CardTitle>
          </div>
          <CardDescription>
            Historical average property prices from 2019 to 2025
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={priceChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis tickFormatter={formatPrice} />
              <Tooltip 
                formatter={(value: number) => formatPrice(value)}
                labelFormatter={(label) => `Year ${label}`}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="price" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                name="Average Price"
                dot={{ fill: "hsl(var(--primary))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Index Change Graph */}
      <Card data-testid="card-index-chart">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle>Price Index Growth (Guzape, Abuja)</CardTitle>
          </div>
          <CardDescription>
            Price index showing percentage change from baseline (2019 = 0)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={indexChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => `${value.toFixed(1)}%`}
                labelFormatter={(label) => `Year ${label}`}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="index" 
                stroke="hsl(var(--chart-2))" 
                strokeWidth={2}
                name="Price Index"
                dot={{ fill: "hsl(var(--chart-2))" }}
              />
            </LineChart>
          </ResponsiveContainer>
          
          {/* Key Insights */}
          <div className="mt-6 p-4 bg-muted rounded-lg">
            <h4 className="font-semibold mb-2">Key Insights:</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• {((indexChartData[indexChartData.length - 1]?.index || 0) / 100).toFixed(1)}x price increase since 2019</li>
              <li>• Average price reached {formatPrice(priceChartData[priceChartData.length - 1]?.price || 0)} in 2025</li>
              <li>• Strong upward trend indicating growing demand in Guzape area</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
