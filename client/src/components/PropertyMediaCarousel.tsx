import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Play, Image } from "lucide-react";

interface PropertyMediaCarouselProps {
  mainImage: string;
  videoUrl?: string | null;
  gallery?: string[] | null;
  propertyName: string;
}

export function PropertyMediaCarousel({ 
  mainImage, 
  videoUrl, 
  gallery, 
  propertyName 
}: PropertyMediaCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  // Combine all media items, only include items that have valid URLs
  const mediaItems = [
    ...(mainImage && mainImage.trim() ? [{ type: 'image', url: mainImage, label: 'Main Image' }] : []),
    ...(videoUrl && videoUrl.trim() ? [{ type: 'video', url: videoUrl, label: 'Property Video' }] : []),
    ...(gallery || []).filter(url => url && url.trim()).map((url, index) => ({ 
      type: 'image', 
      url, 
      label: `Gallery ${index + 1}` 
    }))
  ];

  const totalItems = mediaItems.length;

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? totalItems - 1 : prev - 1));
    setIsVideoPlaying(false);
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === totalItems - 1 ? 0 : prev + 1));
    setIsVideoPlaying(false);
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
    setIsVideoPlaying(false);
  };

  const currentItem = mediaItems[currentIndex];

  if (!currentItem) {
    return (
      <div className="relative w-full h-64 bg-slate-200 rounded-lg flex items-center justify-center">
        <Image className="h-12 w-12 text-slate-400" />
        <span className="ml-2 text-slate-500">No media available</span>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {/* Main Media Display */}
      <div className="relative w-full h-64 md:h-80 lg:h-96 bg-black rounded-lg overflow-hidden">
        {currentItem.type === 'video' ? (
          <div className="relative w-full h-full">
            {!isVideoPlaying ? (
              <div className="relative w-full h-full">
                <video 
                  className="w-full h-full object-cover"
                  preload="metadata"
                >
                  <source src={currentItem.url} type="video/mp4" />
                </video>
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40">
                  <Button
                    onClick={() => setIsVideoPlaying(true)}
                    size="lg"
                    className="bg-white bg-opacity-90 hover:bg-opacity-100 text-black rounded-full p-4"
                  >
                    <Play className="h-8 w-8 ml-1" />
                  </Button>
                </div>
              </div>
            ) : (
              <video 
                className="w-full h-full object-cover"
                controls
                autoPlay
                onEnded={() => setIsVideoPlaying(false)}
              >
                <source src={currentItem.url} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            )}
          </div>
        ) : (
          <img
            src={currentItem.url}
            alt={`${propertyName} - ${currentItem.label}`}
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQgMTZMOC41ODU3OSAxMS40MTQyQzguOTc2MzEgMTEuMDIzNyA5LjYwOTQ4IDExLjAyMzcgMTAgMTEuNDE0MkwxNiAxNk0xNCAxNEwxNS41ODU4IDEyLjQxNDJDMTUuOTc2MyAxMi4wMjM3IDE2LjYwOTUgMTIuMDIzNyAxNyAxMi40MTQyTDIwIDE2TTZIMThDMTkuMTA0NiAxOCAyMCAxNy4xMDQ2IDIwIDE2VjhDMjAgNi44OTU0MyAxOS4xMDQ2IDYgMTggNkg2QzQuODk1NDMgNiA0IDYuODk1NDMgNCA4VjE2QzQgMTcuMTA0NiA0Ljg5NTQzIDE4IDYgMThaIiBzdHJva2U9IiNBMUE1QjAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=';
              target.alt = 'Image not available';
              target.className = 'w-full h-full object-contain bg-slate-200 p-8';
            }}
          />
        )}

        {/* Navigation Arrows */}
        {totalItems > 1 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full p-2"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToNext}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full p-2"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}

        {/* Media Type Indicator */}
        <div className="absolute top-2 left-2 bg-black bg-opacity-60 text-white px-2 py-1 rounded text-xs">
          {currentItem.type === 'video' ? (
            <div className="flex items-center">
              <Play className="h-3 w-3 mr-1" />
              Video
            </div>
          ) : (
            <div className="flex items-center">
              <Image className="h-3 w-3 mr-1" />
              Photo {currentIndex + 1}
            </div>
          )}
        </div>

        {/* Slide Counter */}
        {totalItems > 1 && (
          <div className="absolute top-2 right-2 bg-black bg-opacity-60 text-white px-2 py-1 rounded text-xs">
            {currentIndex + 1} / {totalItems}
          </div>
        )}
      </div>

      {/* Thumbnail Navigation */}
      {totalItems > 1 && (
        <div className="flex space-x-2 mt-3 overflow-x-auto pb-2">
          {mediaItems.map((item, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`relative flex-shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-all ${
                currentIndex === index 
                  ? 'border-blue-500 ring-2 ring-blue-200' 
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {item.type === 'video' ? (
                <div className="w-full h-full bg-black flex items-center justify-center">
                  <Play className="h-4 w-4 text-white" />
                </div>
              ) : (
                <img
                  src={item.url}
                  alt={`Thumbnail ${index + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQgMTZMOC41ODU3OSAxMS40MTQyQzguOTc2MzEgMTEuMDIzNyA5LjYwOTQ4IDExLjAyMzcgMTAgMTEuNDE0MkwxNiAxNk0xNCAxNEwxNS41ODU4IDEyLjQxNDJDMTUuOTc2MyAxMi4wMjM3IDE2LjYwOTUgMTIuMDIzNyAxNyAxMi40MTQyTDIwIDE2TTZIMThDMTkuMTA0NiAxOCAyMCAxNy4xMDQ2IDIwIDE2VjhDMjAgNi44OTU0MyAxOS4xMDQ2IDYgMTggNkg2QzQuODk1NDMgNiA0IDYuODk1NDMgNCA4VjE2QzQgMTcuMTA0NiA0Ljg5NTQzIDE4IDYgMThaIiBzdHJva2U9IiNBMUE1QjAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=';
                    target.alt = 'Thumbnail not available';
                    target.className = 'w-full h-full object-contain bg-slate-300 p-2';
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}