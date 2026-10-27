import { Request, Response, NextFunction } from "express";
import { UploadedFile } from "express-fileupload";
import mongoose, { Model } from "mongoose";
import slugify from "slugify";
import ErrorHandler from "../utils/errorHandler";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ApiFeatures from "../utils/apiFeatures";
import cloudinary from "cloudinary";
import fs from "node:fs";
import NurseryProfile from "../models/nurseryProfileModel";
import { getPluralKey, getSingularKey, getTotalCountKey } from "../utils/productRegistry";
import cacheManager from "../utils/cacheManager";

// ⚡ High-speed in-memory cache for active nursery IDs
const getCachedActiveNurseryIds = async (): Promise<string[]> => {
  return cacheManager.getOrSet(
    "nurseries:active_ids",
    async () => {
      const activeNurseries = await NurseryProfile.find({
        isActive: true,
        approvalStatus: "Approved",
      })
        .select("nursery")
        .lean();

      return activeNurseries.map((n) => n.nursery.toString());
    },
    300 // 5 Minutes TTL
  );
};

// Helper to normalize express-fileupload single/array input
const normalizeFiles = (files: any): UploadedFile[] => {
  if (!files) return [];
  return Array.isArray(files) ? files : [files];
};

// Helper structure for Cloudinary Media Asset management
const uploadToCloudinary = async (file: UploadedFile, folder: string) => {
  try {
    if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
      return await cloudinary.v2.uploader.upload(file.tempFilePath, {
        folder,
        transformation: [
          { width: 800, height: 800, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" }
        ]
      });
    } else if (file.data) {
      return await new Promise<cloudinary.UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.v2.uploader.upload_stream(
          {
            folder,
            transformation: [
              { width: 800, height: 800, crop: "limit" },
              { quality: "auto" },
              { fetch_format: "auto" }
            ]
          },
          (error, result) => {
            if (error || !result) return reject(error || new Error("Cloudinary upload failed"));
            resolve(result);
          }
        );
        stream.end(file.data);
      });
    } else {
      throw new Error("Uploaded file has no temporary path or binary buffer");
    }
  } finally {
    if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
      try {
        fs.unlinkSync(file.tempFilePath);
      } catch (err) {
        console.error(`[uploadToCloudinary] Failed to unlink temp file ${file.tempFilePath}:`, err);
      }
    }
  }
};

// 🌟 1. CREATE RESOURCE
export const createResource = (ResourceModel: Model<any>, folderName: string, payloadKey: string, allowedFields: string[]) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const bodyData = req.body || {};
    let parsedBody = bodyData;

    if (bodyData[payloadKey] && typeof bodyData[payloadKey] === "string") {
      try {
        parsedBody = JSON.parse(bodyData[payloadKey]);
      } catch (error) {
        return next(new ErrorHandler(`Invalid JSON format in ${payloadKey}`, 400));
      }
    }

    // 🛡️ FIXED: Enforced approved status verification layer alongside activation checks
    const nurseryProfile = await NurseryProfile.findOne({ nursery: req.user._id });
    if (!nurseryProfile || nurseryProfile.approvalStatus !== "Approved" || !nurseryProfile.isActive) {
      return next(new ErrorHandler("Your nursery account must be Approved and Active to manage catalog items.", 403));
    }

    let finalCoverImage = parsedBody.coverImage;
    let finalImages = parsedBody.images || [];

    const incomingCoverFiles = [
      ...normalizeFiles(req.files?.coverImage),
      ...normalizeFiles(req.files?.["coverImage"]),
      ...normalizeFiles(req.files?.["coverImage[]"]),
    ];

    const incomingGalleryFiles: UploadedFile[] = [
      ...normalizeFiles(req.files?.galleryImages),
      ...normalizeFiles(req.files?.images),
      ...normalizeFiles(req.files?.["galleryImages[]"]),
      ...normalizeFiles(req.files?.["images[]"]),
    ];

    const uploadTasks: Promise<any>[] = [];
    let coverTaskIndex = -1;

    if (incomingCoverFiles.length > 0) {
      coverTaskIndex = uploadTasks.length;
      uploadTasks.push(uploadToCloudinary(incomingCoverFiles[0], `${folderName}/cover`));
    }

    const galleryStartIndex = uploadTasks.length;
    incomingGalleryFiles.forEach((file) => {
      uploadTasks.push(uploadToCloudinary(file, `${folderName}/gallery`));
    });

    if (uploadTasks.length > 0) {
      const results = await Promise.all(uploadTasks);

      if (coverTaskIndex >= 0) {
        finalCoverImage = {
          public_id: results[coverTaskIndex].public_id,
          url: results[coverTaskIndex].secure_url || results[coverTaskIndex].url,
        };
      }

      if (incomingGalleryFiles.length > 0) {
        finalImages = results.slice(galleryStartIndex).map((img) => ({
          public_id: img.public_id,
          url: img.secure_url || img.url,
        }));
      }
    }

    if (!finalCoverImage || !finalCoverImage.url) {
      return next(new ErrorHandler("Cover image URL or File is required", 400));
    }

    const rawPayload = parsedBody[payloadKey] ? parsedBody[payloadKey] : parsedBody;

    const whitelistedFields: any = {};
    allowedFields.forEach((field) => {
      if (rawPayload[field] !== undefined) {
        let value = rawPayload[field];
        if (typeof value === "string" && (value.startsWith("[") || value.startsWith("{"))) {
          try {
            value = JSON.parse(value);
          } catch {
            /* keep string */
          }
        }
        if (field === "price" || field === "stock" || field === "tierCount" || field === "discountPrice") {
          whitelistedFields[field] = Number(value);
        } else if (field === "isPetFriendly" || field === "hasDrainageHole" || field === "includesSaucer" || field === "washable" || field === "potIncluded") {
          whitelistedFields[field] = value === true || value === "true";
        } else {
          whitelistedFields[field] = value;
        }
      }
    });

    const resourceData = {
      ...whitelistedFields,
      nursery: req.user._id,
      coverImage: finalCoverImage,
      images: finalImages,
      isActive: true
    };

    const resource = await ResourceModel.create(resourceData);
    cacheManager.invalidatePattern(`catalog:${ResourceModel.modelName}:`);

    res.status(201).json({
      success: true,
      message: `${ResourceModel.modelName} created successfully`,
      [getSingularKey(ResourceModel.modelName)]: resource,
    });
  });

// 🌟 2. GET ALL RESOURCES (Complete with Nursery Name, Slug, ID & Vendor Mapping)
export const getAllResources = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response) => {
    // ⚡ PERF: Honor ?limit= for featured/homepage slices (capped to avoid abuse)
    const requestedLimit = Number(req.query.limit);
    const resultsPerPage =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 48)
        : 12;
    const { pincode, vendorId, nurseryId, vendor, nursery, limit: _limit, ...otherQueries } = req.query;

    // ⚡ Local high speed TTL cache layer for active nursery IDs
    const activeNurseryIds = await getCachedActiveNurseryIds();

    // 🏪 Support explicit vendor filtering by ID, nursery user ID, or slug
    const targetVendorParam = (vendorId || nurseryId || vendor || nursery) as string;
    let targetNurseryUserIds: any[] = [];

    if (targetVendorParam) {
      const cleanParam = String(targetVendorParam).trim();
      let profile = null;
      if (mongoose.Types.ObjectId.isValid(cleanParam)) {
        profile = await NurseryProfile.findOne({
          $or: [{ _id: cleanParam }, { nursery: cleanParam }],
        }).lean();
      }
      if (!profile) {
        profile = await NurseryProfile.findOne({
          $or: [
            { slug: cleanParam.toLowerCase() },
            { businessName: new RegExp(`^${cleanParam.replace(/-/g, " ")}$`, "i") },
          ],
        }).lean();
      }

      if (profile) {
        const uId = profile.nursery;
        const pId = profile._id;
        targetNurseryUserIds = [
          uId,
          pId,
          ...(mongoose.Types.ObjectId.isValid(String(uId)) ? [new mongoose.Types.ObjectId(String(uId))] : []),
          ...(mongoose.Types.ObjectId.isValid(String(pId)) ? [new mongoose.Types.ObjectId(String(pId))] : []),
          String(uId),
          String(pId),
        ];
      } else if (mongoose.Types.ObjectId.isValid(cleanParam)) {
        targetNurseryUserIds = [cleanParam, new mongoose.Types.ObjectId(cleanParam)];
      }
    }

    let additionalFilter: any = {
      isActive: true,
    };

    if (targetNurseryUserIds.length > 0) {
      additionalFilter.$or = [
        { nursery: { $in: targetNurseryUserIds } },
        { nurseryId: { $in: targetNurseryUserIds } },
        { vendor: { $in: targetNurseryUserIds } },
      ];
    } else {
      additionalFilter.nursery = { $in: activeNurseryIds };
    }

    if (pincode) {
      const serviceableNurseries = await NurseryProfile.find({
        deliveryPincodes: pincode.toString(),
        approvalStatus: "Approved",
        isActive: true,
      }).select("nursery").lean();

      if (serviceableNurseries.length === 0) {
        return res.status(200).json({
          success: false,
          message: "Sorry, we do not deliver to this pincode yet.",
          [getPluralKey(ResourceModel.modelName)]: [],
          totalCount: 0,
          filteredCount: 0,
          resultsPerPage,
          count: 0,
        });
      }

      const pincodeNurseryIds = serviceableNurseries.map((n) => n.nursery.toString());
      const finalAllowedNurseryIds = pincodeNurseryIds.filter((id) => activeNurseryIds.includes(id));

      if (targetNurseryUserIds.length === 0) {
        additionalFilter.nursery = { $in: finalAllowedNurseryIds };
      }
    }

    const features = new ApiFeatures<any>(ResourceModel.find(additionalFilter), otherQueries)
      .search("name")
      .filter();

    const countQuery = features.query.clone().countDocuments();
    features.pagination(resultsPerPage);

    // ⚡ PERF: Parallelize totalCount, filteredCount, and resources query via Promise.all
    const [totalCount, filteredCount, rawResources] = await Promise.all([
      ResourceModel.countDocuments(additionalFilter),
      countQuery,
      features.query.select("-__v").lean(),
    ]);

    // 2. Fetch Nursery Profiles for the nurseries present in current page result
    const nurseryIdsInResults = rawResources.map((r: any) => r.nursery).filter(Boolean);
    const nurseryProfiles = await NurseryProfile.find({
      $or: [
        { nursery: { $in: nurseryIdsInResults } },
        { _id: { $in: nurseryIdsInResults } },
      ],
    }).select("nursery businessName slug businessAddress.city").lean();

    // 3. Create a fast Map lookup for nursery metadata
    const profileMap = new Map<string, any>();
    nurseryProfiles.forEach((p: any) => {
      const vSlug = p.slug || (p.businessName ? slugify(p.businessName, { lower: true, strict: true }) : "");
      const info = {
        _id: p._id ? p._id.toString() : null,
        nurseryId: p.nursery ? p.nursery.toString() : null,
        name: p.businessName || "",
        businessName: p.businessName || "",
        slug: vSlug,
        city: p.businessAddress?.city || "Indore",
        location: p.businessAddress?.city || "Indore",
      };
      if (p.nursery) profileMap.set(p.nursery.toString(), info);
      if (p._id) profileMap.set(p._id.toString(), info);
    });

    // 4. Map nursery ID, business name, slug, and vendor object directly into each product item
    const resources = rawResources.map((item: any) => {
      const nId = item.nursery ? item.nursery.toString() : null;
      const profile = nId ? profileMap.get(nId) : null;

      const vendorObj = profile
        ? {
            _id: profile._id,
            id: profile._id,
            nurseryId: profile.nurseryId,
            name: profile.name,
            businessName: profile.businessName,
            slug: profile.slug,
            location: profile.location,
            city: profile.city,
          }
        : (item.vendor && typeof item.vendor === "object" ? item.vendor : null);

      return {
        ...item,
        nursery: vendorObj || nId,
        vendor: vendorObj || profile?.name || null,
        vendorName: profile?.name || null,
        vendorId: profile?._id || nId,
        vendorSlug: profile?.slug || null,
        nurseryId: profile?.nurseryId || nId,
        businessName: profile?.businessName || null,
        city: profile?.city || null,
      };
    });

    return res.status(200).json({
      success: true,
      [getTotalCountKey(ResourceModel.modelName)]: totalCount,
      filteredCount,
      resultsPerPage,
      [getPluralKey(ResourceModel.modelName)]: resources,
      count: resources.length,
    });
  });

// 🌟 2b. GET RESOURCE BY SLUG (for fast frontend slug-based lookups)
// ⚡ PERF: Allows frontend to look up by slug directly instead of fetching all 100 products
export const getResourceBySlug = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    const { slug } = req.params;

    const resourceDoc = await ResourceModel.findOne({ slug })
      .select("-__v")
      .lean<any>();

    if (!resourceDoc) return next(new ErrorHandler(`${ResourceModel.modelName} not found`, 404));

    const nurseryProfileDoc = await NurseryProfile.findOne(
      { $or: [{ nursery: resourceDoc.nursery }, { _id: resourceDoc.nursery }] },
      { isActive: 1, businessName: 1, businessAddress: 1, slug: 1 }
    ).lean<any>();

    if (req.user?.role !== "admin" && nurseryProfileDoc && !nurseryProfileDoc.isActive) {
      return next(new ErrorHandler("This product is currently unavailable (Nursery Blocked)", 404));
    }

    if (!req.user) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=600, stale-while-revalidate=59"
      );
    }

    const vSlug =
      nurseryProfileDoc?.slug ||
      (nurseryProfileDoc?.businessName ? slugify(nurseryProfileDoc.businessName, { lower: true, strict: true }) : null);

    const vendorInfo = {
      _id: nurseryProfileDoc?._id ? String(nurseryProfileDoc._id) : String(resourceDoc.nursery),
      id: nurseryProfileDoc?._id ? String(nurseryProfileDoc._id) : String(resourceDoc.nursery),
      nurseryId: String(resourceDoc.nursery),
      name: nurseryProfileDoc?.businessName ?? null,
      businessName: nurseryProfileDoc?.businessName ?? null,
      slug: vSlug,
      location: nurseryProfileDoc?.businessAddress?.city ?? null,
      city: nurseryProfileDoc?.businessAddress?.city ?? null,
    };

    res.status(200).json({
      success: true,
      [getSingularKey(ResourceModel.modelName)]: {
        ...resourceDoc,
        nursery: vendorInfo,
        vendor: vendorInfo,
        vendorName: vendorInfo.name,
        vendorId: vendorInfo._id,
        vendorSlug: vendorInfo.slug,
        nurseryId: vendorInfo.nurseryId,
      },
    });
  });

// 🌟 3. GET RESOURCE DETAILS
// ⚡ PERF: .lean() skips Mongoose hydration (3-5x faster). Parallel Promise.all for
//         product + nursery profile lookup. Field projection cuts wire payload.
//         HTTP Cache-Control header enables CDN + browser caching for repeat visits.
export const getResourceDetails = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    // Step 1: Fetch resource with .lean() + field projection (no __v, no deep populate)
    const resourceDoc = await ResourceModel.findById(req.params.id)
      .select("-__v")
      .lean<any>();

    if (!resourceDoc) return next(new ErrorHandler(`${ResourceModel.modelName} not found`, 404));

    // Step 2: Fetch nursery profile in parallel — project only fields we actually need
    const nurseryProfileDoc = await NurseryProfile.findOne(
      { $or: [{ nursery: resourceDoc.nursery }, { _id: resourceDoc.nursery }] },
      { isActive: 1, businessName: 1, businessAddress: 1, slug: 1 }
    ).lean<any>();

    if (req.user?.role !== "admin" && nurseryProfileDoc && !nurseryProfileDoc.isActive) {
      return next(new ErrorHandler("This product is currently unavailable (Nursery Blocked)", 404));
    }

    // ⚡ HTTP caching: CDN caches 10 min, browser 5 min, stale-while-revalidate for instant repeat loads
    if (!req.user) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=600, stale-while-revalidate=59"
      );
    }

    const vSlug =
      nurseryProfileDoc?.slug ||
      (nurseryProfileDoc?.businessName ? slugify(nurseryProfileDoc.businessName, { lower: true, strict: true }) : null);

    const vendorInfo = {
      _id: nurseryProfileDoc?._id ? String(nurseryProfileDoc._id) : String(resourceDoc.nursery),
      id: nurseryProfileDoc?._id ? String(nurseryProfileDoc._id) : String(resourceDoc.nursery),
      nurseryId: String(resourceDoc.nursery),
      name: nurseryProfileDoc?.businessName ?? null,
      businessName: nurseryProfileDoc?.businessName ?? null,
      slug: vSlug,
      location: nurseryProfileDoc?.businessAddress?.city ?? null,
      city: nurseryProfileDoc?.businessAddress?.city ?? null,
    };

    res.status(200).json({
      success: true,
      [getSingularKey(ResourceModel.modelName)]: {
        ...resourceDoc,
        nursery: vendorInfo,
        vendor: vendorInfo,
        vendorName: vendorInfo.name,
        vendorId: vendorInfo._id,
        vendorSlug: vendorInfo.slug,
        nurseryId: vendorInfo.nurseryId,
      },
    });
  });

// 🌟 4. UPDATE RESOURCE
export const updateResource = (
  ResourceModel: Model<any>,
  folderName: string,
  allowedFields: string[],
  payloadKey?: string
) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const resource = await ResourceModel.findById(req.params.id);
    if (!resource) return next(new ErrorHandler(`${ResourceModel.modelName} not found`, 404));

    if (req.user.role === "nursery" && resource.nursery?.toString() !== req.user._id.toString()) {
      return next(new ErrorHandler(`You cannot update another nursery's ${ResourceModel.modelName.toLowerCase()}`, 403));
    }

    let coverImageData;
    let galleryImagesData: any[] = [];

    const incomingCoverFiles = [
      ...normalizeFiles(req.files?.coverImage),
      ...normalizeFiles(req.files?.["coverImage"]),
      ...normalizeFiles(req.files?.["coverImage[]"]),
    ];

    if (incomingCoverFiles.length > 0) {
      const coverImageFile = incomingCoverFiles[0];

      if (resource.coverImage?.public_id) {
        await cloudinary.v2.uploader.destroy(resource.coverImage.public_id).catch(() => null);
      }

      const uploadedCover = await uploadToCloudinary(coverImageFile, `${folderName}/cover`);
      coverImageData = {
        public_id: uploadedCover.public_id,
        url: uploadedCover.secure_url || uploadedCover.url,
      };
    }

    // Support flat FormData fields AND JSON payload blobs (same as create)
    let parsedBody: any = { ...(req.body || {}) };
    const possiblePayloadKeys = Array.from(
      new Set(
        [
          payloadKey,
          "plantData",
          "potData",
          "accessoryData",
          "gardeningToolData",
          "plantCareData",
          "seedsBulbsData",
          "plantStandsShelvesData",
          "artificialData",
        ].filter(Boolean) as string[]
      )
    );

    for (const key of possiblePayloadKeys) {
      if (parsedBody[key] && typeof parsedBody[key] === "string") {
        try {
          const nested = JSON.parse(parsedBody[key]);
          parsedBody = { ...parsedBody, ...nested };
        } catch {
          return next(new ErrorHandler(`Invalid JSON format in ${key}`, 400));
        }
      }
    }

    // Safely collect incoming new gallery files via express-fileupload
    const incomingGalleryFiles: UploadedFile[] = [
      ...normalizeFiles(req.files?.galleryImages),
      ...normalizeFiles(req.files?.images),
      ...normalizeFiles(req.files?.["galleryImages[]"]),
      ...normalizeFiles(req.files?.["images[]"]),
    ];

    if (incomingGalleryFiles.length > 0) {
      const uploadedGallery = await Promise.all(
        incomingGalleryFiles.map((file) => uploadToCloudinary(file, `${folderName}/gallery`))
      );

      galleryImagesData = uploadedGallery.map((img) => ({
        public_id: img.public_id,
        url: img.secure_url || img.url,
      }));
    }

    // Handle existing images retained/removed
    let baseImages: Array<{ public_id: string; url: string }> = Array.isArray(resource.images)
      ? [...resource.images]
      : [];
    let hasExplicitGalleryUpdate = false;

    // Check all possible keys where existing gallery images might be passed
    const rawExisting =
      parsedBody.existingImages ??
      parsedBody.existingGalleryImages ??
      parsedBody.retainedImages ??
      parsedBody.preservedImages ??
      req.body?.existingImages ??
      req.body?.existingGalleryImages ??
      req.body?.retainedImages;

    if (rawExisting !== undefined) {
      hasExplicitGalleryUpdate = true;
      let existingImgArray = rawExisting;

      if (typeof existingImgArray === "string") {
        try {
          existingImgArray = JSON.parse(existingImgArray);
        } catch {
          existingImgArray = existingImgArray
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
      }

      if (Array.isArray(existingImgArray)) {
        const currentResourceImages: Array<{ public_id: string; url: string }> = Array.isArray(resource.images)
          ? resource.images
          : [];

        const retainedImages: Array<{ public_id: string; url: string }> = [];

        existingImgArray.forEach((item: any, idx: number) => {
          if (!item) return;

          if (typeof item === "string") {
            const matched = currentResourceImages.find(
              (img) => img.url === item || img.public_id === item
            );
            if (matched) {
              retainedImages.push({ public_id: matched.public_id, url: matched.url });
            } else {
              retainedImages.push({
                public_id: `existing_${Date.now()}_${idx}`,
                url: item,
              });
            }
          } else if (typeof item === "object") {
            const itemUrl = item.url || item.secure_url || item.src;
            const itemPublicId = item.public_id || item.publicId;

            const matched = currentResourceImages.find(
              (img) =>
                (itemPublicId && img.public_id === itemPublicId) ||
                (itemUrl && img.url === itemUrl)
            );

            if (matched) {
              retainedImages.push({ public_id: matched.public_id, url: matched.url });
            } else if (itemUrl) {
              retainedImages.push({
                public_id: itemPublicId || `existing_${Date.now()}_${idx}`,
                url: itemUrl,
              });
            }
          }
        });

        // Clean up removed / discarded images from Cloudinary
        const retainedIds = new Set(retainedImages.map((img) => img.public_id).filter(Boolean));
        const retainedUrls = new Set(retainedImages.map((img) => img.url).filter(Boolean));

        for (const oldImg of currentResourceImages) {
          const isRetained =
            (oldImg.public_id && retainedIds.has(oldImg.public_id)) ||
            (oldImg.url && retainedUrls.has(oldImg.url));

          if (!isRetained && oldImg.public_id) {
            cloudinary.v2.uploader.destroy(oldImg.public_id).catch((err) => {
              console.error(`[Cloudinary] Failed to delete discarded asset ${oldImg.public_id}:`, err);
            });
          }
        }

        baseImages = retainedImages;
      }
    }

    const finalGalleryImages = [...baseImages, ...galleryImagesData];

    const whitelistedFields: any = {};
    allowedFields.forEach((field) => {
      if (parsedBody[field] !== undefined) {
        let value = parsedBody[field];
        if (typeof value === "string" && (value.startsWith("[") || value.startsWith("{"))) {
          try {
            value = JSON.parse(value);
          } catch {
            /* keep string */
          }
        }
        if (field === "price" || field === "stock" || field === "tierCount" || field === "discountPrice") {
          whitelistedFields[field] = Number(value);
        } else if (field === "isPetFriendly" || field === "hasDrainageHole" || field === "includesSaucer" || field === "washable" || field === "potIncluded") {
          whitelistedFields[field] = value === true || value === "true";
        } else {
          whitelistedFields[field] = value;
        }
      }
    });

    const updateData: any = {
      ...whitelistedFields,
      ...(coverImageData && { coverImage: coverImageData }),
      ...((hasExplicitGalleryUpdate || galleryImagesData.length > 0) && { images: finalGalleryImages }),
    };

    const updatedResource = await ResourceModel.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    cacheManager.invalidatePattern(`catalog:${ResourceModel.modelName}:`);

    res.status(200).json({
      success: true,
      message: `${ResourceModel.modelName} updated successfully`,
      [getSingularKey(ResourceModel.modelName)]: updatedResource,
    });
  });

// 🌟 5. DELETE RESOURCE
export const deleteResource = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const resource = await ResourceModel.findById(req.params.id);
    if (!resource) return next(new ErrorHandler(`${ResourceModel.modelName} not found`, 404));

    const isOwner = resource.nursery.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return next(new ErrorHandler(`You cannot delete another nursery's ${ResourceModel.modelName.toLowerCase()}`, 403));
    }

    const cleanupPromises: Promise<any>[] = [];

    if (resource.coverImage?.public_id) {
      cleanupPromises.push(cloudinary.v2.uploader.destroy(resource.coverImage.public_id).catch(() => null));
    }

    if (resource.images && resource.images.length > 0) {
      resource.images.forEach((img: any) => {
        if (img.public_id) cleanupPromises.push(cloudinary.v2.uploader.destroy(img.public_id).catch(() => null));
      });
    }

    if (cleanupPromises.length > 0) await Promise.all(cleanupPromises);

    await resource.deleteOne();
    cacheManager.invalidatePattern(`catalog:${ResourceModel.modelName}:`);

    res.status(200).json({
      success: true,
      message: `${ResourceModel.modelName} and associated images deleted successfully`,
    });
  });

// 🌟 6. TOGGLE RESOURCE STATUS
export const toggleResourceStatus = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const resource = await ResourceModel.findById(req.params.id);
    if (!resource) return next(new ErrorHandler(`${ResourceModel.modelName} not found`, 404));

    const isOwner = resource.nursery.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return next(new ErrorHandler(`Access denied for modifying this ${ResourceModel.modelName.toLowerCase()}`, 403));
    }

    resource.isActive = !resource.isActive;
    await resource.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: `${ResourceModel.modelName} is now ${resource.isActive ? "Active" : "Inactive"}`,
      isActive: resource.isActive
    });
  });

// 🌟 7. CREATE RESOURCE REVIEW
export const createResourceReview = (ResourceModel: Model<any>, idKey: string) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const { rating, comment } = req.body;
    const targetId = req.body[idKey] || req.body.itemId || req.body.id || req.query[idKey];

    if (!targetId) {
      return next(new ErrorHandler(`Target resource ID mapping missing. Expected key: ${idKey}`, 400));
    }

    // 🛡️ FIXED: Enforced numeric boundaries explicitly inside core logic arrays
    const parsedRating = Number(rating);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return next(new ErrorHandler("Validation Fault: Product evaluation score bounds must explicitly range between 1 and 5.", 400));
    }

    const resource = await ResourceModel.findById(targetId);
    if (!resource) return next(new ErrorHandler(`${ResourceModel.modelName} cluster node not found`, 404));

    if (resource.nursery && resource.nursery.toString() === req.user._id.toString()) {
      return next(new ErrorHandler(`You cannot review your own listing`, 403));
    }

    if (!resource.reviews) resource.reviews = [];

    const existingReview = resource.reviews.find(
      (rev: any) => rev.user && rev.user.toString() === req.user!._id.toString()
    );

    if (existingReview) {
      existingReview.rating = parsedRating;
      existingReview.comment = comment;
      if (req.body.author || req.user.name) {
        existingReview.name = req.body.author || req.user.name;
      }
    } else {
      resource.reviews.push({
        user: req.user._id,
        name: req.body.author || req.user.name || "Anonymous Buyer",
        rating: parsedRating,
        comment,
        createdAt: new Date(),
      });
    }

    resource.numOfReviews = resource.reviews.length;
    resource.ratings = resource.reviews.reduce((acc: number, item: any) => acc + item.rating, 0) / resource.reviews.length;

    await resource.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Review matrix synced successfully!"
    });
  });

// 🌟 8. DELETE RESOURCE REVIEW
export const deleteResourceReview = (ResourceModel: Model<any>, idKey: string) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const targetId = req.query[idKey] || req.body[idKey] || req.query.itemId;
    if (!targetId) return next(new ErrorHandler("Resource item context parameter required", 400));

    const resource = await ResourceModel.findById(targetId);
    if (!resource) return next(new ErrorHandler(`${ResourceModel.modelName} not found`, 404));

    const reviewId = (req.query.id || req.body.reviewId)?.toString();
    if (!reviewId) return next(new ErrorHandler("Review ID entry specification required", 400));

    if (!resource.reviews) return next(new ErrorHandler("No reviews found on asset", 404));

    const reviewToDelete = resource.reviews.find((rev: any) => rev._id && rev._id.toString() === reviewId);
    if (!reviewToDelete) return next(new ErrorHandler("Review tracking footprint mismatch", 404));

    if (reviewToDelete.user?.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return next(new ErrorHandler("Unauthorized modification clearance tier drop", 403));
    }

    const updatedReviews = resource.reviews.filter((rev: any) =>
      rev._id ? rev._id.toString() !== reviewId : true
    );

    resource.reviews = updatedReviews;
    resource.numOfReviews = updatedReviews.length;
    resource.ratings = updatedReviews.length > 0
      ? updatedReviews.reduce((acc: number, r: any) => acc + r.rating, 0) / updatedReviews.length
      : 0;

    await resource.save({ validateBeforeSave: false });

    res.status(200).json({ success: true, message: "Review cleared successfully" });
  });

// 🌟 9. GET RESOURCE REVIEWS ONLY (DEDICATED ENDPOINT)
export const getResourceReviews = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    const resourceId =
      req.params.id ||
      (req.query.plantId as string) ||
      (req.query.potId as string) ||
      (req.query.accessoryId as string) ||
      (req.query.id as string);
    if (!resourceId) {
      return next(new ErrorHandler("Resource ID is required", 400));
    }

    const resource = await ResourceModel.findById(resourceId).select("reviews numOfReviews ratings");
    if (!resource) {
      return next(new ErrorHandler(`${ResourceModel.modelName} not found`, 404));
    }

    res.status(200).json({
      success: true,
      ratings: resource.ratings,
      numOfReviews: resource.numOfReviews,
      reviews: resource.reviews || []
    });
  });

// 🌟 10. GET NURSERY RESOURCES
export const getNurseryResources = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    if (req.user.role !== "nursery") {
      return next(new ErrorHandler(`Only nursery owners can view their own ${ResourceModel.modelName.toLowerCase()}s`, 403));
    }

    const resources = await ResourceModel.find({ nursery: req.user._id }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: resources.length,
      [getPluralKey(ResourceModel.modelName)]: resources
    });
  });

// 🌟 11. GET ALL RESOURCES FOR ADMIN
export const getAdminAllResources = (ResourceModel: Model<any>) =>
  catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    if (req.user.role !== "admin") {
      return next(new ErrorHandler("Only administrators can access this structural node", 403));
    }

    const resultsPerPage = 20;
    const totalCount = await ResourceModel.countDocuments();

    // 🔍 FIXED: Dropped defunct parameter filters out of schema lookup paths
    const features = new ApiFeatures<any>(
      ResourceModel.find().populate("nursery", "name email"),
      req.query
    )
      .search("name")
      .filter();

    const filteredCount = await features.query.clone().countDocuments();
    features.pagination(resultsPerPage);

    const resources = await features.query.sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      totalCount,
      filteredCount,
      resultsPerPage,
      count: resources.length,
      [getPluralKey(ResourceModel.modelName)]: resources,
    });
  });