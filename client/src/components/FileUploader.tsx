import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, Image } from "lucide-react";

interface FileUploaderProps {
  onUpload: (files: File[]) => Promise<void>;
  maxFiles?: number;
  maxFileSize?: number;
  accept?: string;
  disabled?: boolean;
}

export function FileUploader({
  onUpload,
  maxFiles = 5,
  maxFileSize = 10485760, // 10MB
  accept = "image/*",
  disabled = false
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const validateFile = (file: File): string | null => {
    if (file.size > maxFileSize) {
      return `File "${file.name}" is too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB`;
    }
    if (accept && !file.type.match(accept.replace('*', '.*'))) {
      return `File "${file.name}" is not a supported image format`;
    }
    return null;
  };

  const handleFiles = useCallback((files: FileList) => {
    const fileArray = Array.from(files);
    const validFiles: File[] = [];
    const errors: string[] = [];

    // Check file count
    if (fileArray.length + selectedFiles.length > maxFiles) {
      errors.push(`Maximum ${maxFiles} files allowed`);
      return;
    }

    // Validate each file
    for (const file of fileArray) {
      const error = validateFile(file);
      if (error) {
        errors.push(error);
      } else {
        validFiles.push(file);
      }
    }

    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    setSelectedFiles(prev => [...prev, ...validFiles]);
  }, [selectedFiles, maxFiles, maxFileSize, accept]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  }, [disabled, handleFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    // Reset input value to allow selecting the same file again
    e.target.value = '';
  }, [handleFiles]);

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsUploading(true);
    try {
      await onUpload(selectedFiles);
      setSelectedFiles([]);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      {/* Main Upload Area */}
      <div
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragging 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-slate-300 hover:border-slate-400'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          multiple
          accept={accept}
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />
        
        <div className="flex flex-col items-center space-y-3">
          <Upload className="h-12 w-12 text-slate-400" />
          <div>
            <p className="text-lg font-medium text-slate-700">
              Drop your images here or click to browse
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Maximum {maxFiles} files, up to {Math.round(maxFileSize / 1024 / 1024)}MB each
            </p>
          </div>
        </div>
      </div>

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium text-slate-700">Selected Files ({selectedFiles.length})</h4>
          <div className="space-y-2">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border"
              >
                <div className="flex items-center space-x-3">
                  <Image className="h-5 w-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{file.name}</p>
                    <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(index)}
                  className="h-8 w-8 p-0 text-slate-400 hover:text-red-500"
                  disabled={disabled || isUploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Button */}
      {selectedFiles.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            disabled={disabled || isUploading || selectedFiles.length === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isUploading ? 'Uploading...' : `Upload ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      )}
    </div>
  );
}