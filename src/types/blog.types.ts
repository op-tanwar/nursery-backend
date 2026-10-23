import { Document, Types } from "mongoose";

export interface IBlog {
  title: string;
  slug: string;
  content: string;
  author: Types.ObjectId; // References Admin or User (Nursery) document
  authorType: "Admin" | "Nursery";
  coverImage: string;
  tags: string[];
  views: number;
}

// Extends mongoose Document to include default fields like _id, createdAt, updatedAt
export interface IBlogDocument extends IBlog, Document {
  createdAt: Date;
  updatedAt: Date;
}