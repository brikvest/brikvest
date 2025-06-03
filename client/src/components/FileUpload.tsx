import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, FileText, Image } from "lucide-react";

interface FileUploadProps {
  onUploadSuccess: (url: string, fileName: string) => void;
  accept: string;
  uploadType: 'document' | 'image';
  label: string;
  currentFile?: string;
  disabled?: boolean;
}

export function FileUpload({ 
  onUploadSuccess, 
  accept, 
  uploadType, 
  label, 
  currentFile,
  disabled = false 
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = async (file: File) => {
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append(uploadType === 'document' ? 'document' : 'image', file);

      const response = await fetch(`/api/upload/${uploadType}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      onUploadSuccess(result.url, result.originalName);
      
      toast({
        title: "Success",
        description: `${uploadType === 'document' ? 'Document' : 'Image'} uploaded successfully`
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Error",
        description: "Failed to upload file",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleRemove = () => {
    onUploadSuccess('', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      
      {currentFile ? (
        <div className="flex items-center space-x-2 p-3 border rounded-lg bg-slate-50">
          {uploadType === 'document' ? (
            <FileText className="w-4 h-4 text-blue-600" />
          ) : (
            <Image className="w-4 h-4 text-green-600" />
          )}
          <span className="text-sm flex-1 truncate">{currentFile.split('/').pop()}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragOver 
              ? 'border-blue-400 bg-blue-50' 
              : 'border-slate-300 hover:border-slate-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
          <p className="text-sm text-slate-600 mb-2">
            {uploading 
              ? `Uploading ${uploadType}...` 
              : `Click to upload or drag and drop your ${uploadType}`
            }
          </p>
          <p className="text-xs text-slate-500">
            {uploadType === 'document' ? 'PDF, DOC, DOCX' : 'JPG, PNG, WEBP'} up to 10MB
          </p>
        </div>
      )}

      <Input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />
    </div>
  );
}