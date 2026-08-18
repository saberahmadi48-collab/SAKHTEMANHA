/**
 * فرهنگ متن‌های فارسی — تنها منبع مجاز برای هر رشته‌ای که کاربر می‌بیند.
 *
 * چرا یک فایل مشترک به‌جای رشته‌های پراکنده در کامپوننت‌ها:
 *   ۱. پیام خطای API و متن رابط کاربری باید یکسان باشند. اگر گارد بگوید
 *      «دسترسی ندارید» و UI بگوید «Access denied»، کاربر دو زبان می‌بیند.
 *   ۲. با یک بار جست‌وجو می‌توان ثابت کرد هیچ متن انگلیسی‌ای باقی نمانده —
 *      اسکریپت `i18n:lint` دقیقاً همین را بررسی می‌کند.
 *   ۳. افزودن زبان دوم در آینده فقط یک فایل هم‌شکل می‌خواهد، نه بازنویسی UI.
 *
 * قاعده: هیچ کامپوننتی حق ندارد رشته‌ی فارسی را مستقیم بنویسد؛ باید از اینجا
 * بخواند. این تنها راهی است که «۱۰۰٪ فارسی» قابل اثبات می‌ماند، نه ادعایی.
 */

/** متن‌های عمومی و پرتکرار (دکمه‌ها، وضعیت‌ها، اقدامات). */
export const COMMON = {
  // --- اقدامات ---
  submit: 'ثبت',
  save: 'ذخیره',
  saveChanges: 'ذخیره تغییرات',
  cancel: 'انصراف',
  confirm: 'تأیید',
  edit: 'ویرایش',
  delete: 'حذف',
  archive: 'بایگانی',
  restore: 'بازگردانی',
  add: 'افزودن',
  create: 'ایجاد',
  search: 'جست‌وجو',
  filter: 'فیلتر',
  clearFilters: 'حذف فیلترها',
  refresh: 'به‌روزرسانی',
  back: 'بازگشت',
  next: 'بعدی',
  previous: 'قبلی',
  close: 'بستن',
  view: 'مشاهده',
  details: 'جزئیات',
  download: 'دانلود',
  upload: 'بارگذاری',
  print: 'چاپ',
  export: 'خروجی',
  copy: 'کپی',
  copied: 'کپی شد',
  retry: 'تلاش دوباره',
  more: 'بیشتر',
  selectPlaceholder: 'انتخاب کنید…',
  searchPlaceholder: 'جست‌وجو کنید…',
  optional: 'اختیاری',
  required: 'الزامی',
  yes: 'بله',
  no: 'خیر',
  all: 'همه',
  none: 'هیچ‌کدام',
  unknown: 'نامشخص',
  notSpecified: 'ثبت نشده',

  // --- وضعیت‌ها ---
  loading: 'در حال بارگذاری…',
  saving: 'در حال ذخیره…',
  sending: 'در حال ارسال…',
  processing: 'در حال پردازش…',
  savedSuccessfully: 'با موفقیت ذخیره شد',
  createdSuccessfully: 'با موفقیت ایجاد شد',
  updatedSuccessfully: 'با موفقیت به‌روزرسانی شد',
  deletedSuccessfully: 'با موفقیت حذف شد',
  operationFailed: 'انجام عملیات ناموفق بود',
} as const;

/** پیمایش و منوها. */
export const NAV = {
  dashboard: 'داشبورد',
  buildings: 'ساختمان‌ها',
  units: 'واحدها',
  residents: 'ساکنان',
  members: 'اعضا',
  finance: 'امور مالی',
  ledger: 'دفتر حساب',
  charges: 'شارژها',
  invoices: 'صورت‌حساب‌ها',
  payments: 'پرداخت‌ها',
  maintenance: 'نگهداری و تعمیرات',
  workOrders: 'درخواست‌های کار',
  serviceProviders: 'ارائه‌دهندگان خدمات',
  governance: 'هیئت مدیره',
  elections: 'انتخابات',
  managementTerms: 'دوره‌های مدیریت',
  handover: 'تحویل و تحول',
  announcements: 'اطلاعیه‌ها',
  messages: 'پیام‌ها',
  documents: 'اسناد',
  reports: 'گزارش‌ها',
  settings: 'تنظیمات',
  profile: 'پروفایل',
  auditLog: 'گزارش رویدادها',
  logout: 'خروج از حساب',
  login: 'ورود',
  skipToContent: 'رفتن به محتوای اصلی',
  openMenu: 'باز کردن منو',
  closeMenu: 'بستن منو',
  toggleTheme: 'تغییر پوسته',
  userMenu: 'منوی کاربر',
  breadcrumb: 'مسیر صفحه',
} as const;

/**
 * برچسب فارسی نقش‌ها.
 *
 * کلیدها دقیقاً با enum های `BuildingRole` و `OrganizationRole` در Prisma و
 * با تایپ‌های `BuildingRoleName` / `OrganizationRoleName` در پکیج contracts
 * یکی هستند. تابع `buildingRoleLabel` این هم‌ترازی را در زمان کامپایل بررسی
 * می‌کند، پس افزودن نقش جدید بدون برچسب فارسی باعث خطای کامپایل می‌شود —
 * دقیقاً همان چیزی که جلوی نشت متن انگلیسی به UI را می‌گیرد.
 */
export const BUILDING_ROLE_LABELS = {
  BUILDING_MANAGER: 'مدیر ساختمان',
  BOARD_MEMBER: 'عضو هیئت مدیره',
  AUDITOR: 'بازرس',
  OWNER: 'مالک',
  TENANT: 'مستأجر',
  STAFF: 'کارکنان',
  VIEWER: 'بیننده',
} as const;

export const ORGANIZATION_ROLE_LABELS = {
  ORG_OWNER: 'مالک سازمان',
  ORG_ADMIN: 'مدیر سازمان',
  ORG_BILLING: 'مسئول مالی سازمان',
  ORG_VIEWER: 'بیننده سازمان',
} as const;

/** برچسب وضعیت‌ها — هم‌تراز با enum های Prisma. */
export const STATUS_LABELS = {
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  PENDING: 'در انتظار',
  PENDING_VERIFICATION: 'در انتظار تأیید',
  SUSPENDED: 'معلق',
  ENDED: 'پایان‌یافته',
  ARCHIVED: 'بایگانی‌شده',
  DRAFT: 'پیش‌نویس',
  SCHEDULED: 'زمان‌بندی‌شده',
  COMPLETED: 'تکمیل‌شده',
  CANCELLED: 'لغوشده',
  TERMINATED: 'خاتمه‌یافته',
  ACCEPTED: 'پذیرفته‌شده',
  REVOKED: 'باطل‌شده',
  EXPIRED: 'منقضی‌شده',
  DEACTIVATED: 'غیرفعال‌شده',
  // وضعیت‌های ساختمان (BM-01 §8)
  UNMANAGED: 'بدون مدیر',
  DECOMMISSIONED: 'خارج از بهره‌برداری',
  // وضعیت‌های واحد (BM-01 §16)
  UNDER_CONSTRUCTION: 'در حال ساخت',
  UNDER_RENOVATION: 'در حال بازسازی',
  // وضعیت تحویل و تحول (BM-06)
  NOT_STARTED: 'آغاز نشده',
  IN_PROGRESS: 'در جریان',
  DISPUTED: 'مورد اختلاف',
} as const;

/** برچسب نوع کاربری واحد — هم‌تراز با enum `UnitKind`. */
export const UNIT_KIND_LABELS = {
  RESIDENTIAL: 'مسکونی',
  COMMERCIAL: 'تجاری',
  OFFICE: 'اداری',
  PARKING: 'پارکینگ',
  STORAGE: 'انباری',
  COMMON_AREA: 'مشاعات',
  OTHER: 'سایر',
} as const;

/** برچسب نوع سازمان — هم‌تراز با enum `OrganizationType` (BM-01 §4). */
export const ORGANIZATION_TYPE_LABELS = {
  INDIVIDUAL: 'مدیر شخصی',
  PROPERTY_MANAGEMENT_COMPANY: 'شرکت مدیریت ساختمان',
  ENTERPRISE: 'سازمان بزرگ',
  OTHER: 'سایر',
} as const;

/** برچسب نوع سکونت — هم‌تراز با enum `OccupancyKind` (BM-01 §20). */
export const OCCUPANCY_KIND_LABELS = {
  OWNER_OCCUPIED: 'سکونت مالک',
  TENANT: 'مستأجر',
  OTHER: 'سایر',
  VACANT: 'خالی',
} as const;

/**
 * برچسب دوره‌ی صدور شارژ — هم‌تراز با enum `ChargeCycle` (BM-01 §27).
 * خود محاسبه‌ی شارژ به BM-03 مربوط است؛ اینجا فقط متن نمایش است.
 */
export const CHARGE_CYCLE_LABELS = {
  MONTHLY: 'ماهانه',
  QUARTERLY: 'سه‌ماهه',
  SEMI_ANNUAL: 'شش‌ماهه',
  ANNUAL: 'سالانه',
} as const;

/** برچسب سطح دقت موقعیت مکانی — هم‌تراز با enum `LocationPrecision` (BM-01 §11). */
export const LOCATION_PRECISION_LABELS = {
  EXACT: 'دقیق',
  APPROXIMATE: 'تقریبی',
  HIDDEN: 'پنهان',
} as const;

/**
 * پیام‌های خطا.
 *
 * `validation` عمداً تابع است نه رشته‌ی ثابت: پیام باید نام فارسی فیلد را در
 * خود داشته باشد («کد ملی الزامی است»)، وگرنه کاربر نمی‌داند کدام فیلد ایراد
 * دارد. `class-validator` پیام پیش‌فرض انگلیسی تولید می‌کند و ما آن را کامل
 * جایگزین می‌کنیم — این یکی از موارد صریحاً ممنوع در دستور بود.
 */
export const VALIDATION = {
  required: (field: string) => `${field} الزامی است`,
  invalid: (field: string) => `${field} معتبر نیست`,
  tooShort: (field: string, min: number) =>
    `${field} باید حداقل ${toPersianDigits(min)} نویسه باشد`,
  tooLong: (field: string, max: number) =>
    `${field} باید حداکثر ${toPersianDigits(max)} نویسه باشد`,
  notANumber: (field: string) => `${field} باید عدد باشد`,
  outOfRange: (field: string, min: number, max: number) =>
    `${field} باید بین ${toPersianDigits(min)} و ${toPersianDigits(max)} باشد`,
  invalidEmail: 'نشانی رایانامه معتبر نیست',
  invalidPhone: 'شماره تلفن همراه معتبر نیست (مثال: ۰۹۱۲۱۲۳۴۵۶۷)',
  invalidNationalId: 'کد ملی معتبر نیست',
  invalidDate: 'تاریخ معتبر نیست',
  invalidUuid: 'شناسه معتبر نیست',
  passwordTooWeak:
    'گذرواژه باید حداقل ۸ نویسه و شامل حرف و رقم باشد',
  passwordMismatch: 'گذرواژه و تکرار آن یکسان نیستند',
  unexpectedField: (field: string) => `فیلد «${field}» مجاز نیست`,
  dateRangeInvalid: 'تاریخ پایان باید بعد از تاریخ شروع باشد',
  amountMustBePositive: 'مبلغ باید بزرگ‌تر از صفر باشد',
} as const;

/**
 * پیام‌های خطای سطح API.
 *
 * نکته‌ی امنیتی که در ترجمه حفظ شده: «ساختمان در دسترس نیست» عمداً بین
 * «وجود ندارد» و «متعلق به شما نیست» تفاوتی نمی‌گذارد، چون تفکیک آن‌ها به
 * مهاجم اجازه می‌دهد شناسه‌های معتبر را شمارش کند. ترجمه نباید این را بشکند.
 */
export const ERRORS = {
  // احراز هویت
  unauthenticated: 'برای ادامه باید وارد حساب کاربری خود شوید',
  sessionExpired: 'نشست شما منقضی شده است. دوباره وارد شوید',
  invalidCredentials: 'نام کاربری یا گذرواژه نادرست است',
  accountDisabled: 'حساب کاربری شما غیرفعال شده است',

  // دسترسی
  forbidden: 'شما به این بخش دسترسی ندارید',
  buildingNotAccessible: 'این ساختمان در دسترس شما نیست',
  organizationNotAccessible: 'این سازمان در دسترس شما نیست',
  missingPermissions: (permissions: string) =>
    `برای این کار دسترسی لازم را ندارید: ${permissions}`,

  // درخواست
  notFound: 'موردی که دنبال آن بودید یافت نشد',
  conflict: 'این عملیات با وضعیت فعلی سامانه تداخل دارد',
  validationFailed: 'اطلاعات واردشده نادرست است',
  tooManyRequests: 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید',

  // سرور و شبکه
  serverError: 'خطایی در سامانه رخ داد. لطفاً دوباره تلاش کنید',
  networkError: 'ارتباط با سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید',
  timeout: 'زمان پاسخ‌گویی سرور به پایان رسید',

  // قواعد دامنه (برگرفته از BM-00)
  buildingArchived: 'این ساختمان بایگانی شده است و قابل تغییر نیست',
  termNotActive: 'دوره مدیریت فعالی برای این ساختمان وجود ندارد',
  overlappingPeriod: 'این بازه زمانی با یک بازه ثبت‌شده دیگر هم‌پوشانی دارد',
  cannotDeleteHistorical:
    'سوابق تاریخی حذف نمی‌شوند؛ برای اصلاح از سند برگشتی استفاده کنید',

  // ثبت‌نام و حساب کاربری (BM-01 §32)
  emailAlreadyRegistered: 'این نشانی رایانامه قبلاً ثبت شده است',
  phoneAlreadyRegistered: 'این شماره همراه قبلاً ثبت شده است',
  emailOrPhoneRequired: 'دست‌کم یکی از رایانامه یا شماره همراه باید وارد شود',
  accountLocked:
    'به دلیل تلاش‌های ناموفق، حساب شما موقتاً قفل شده است. کمی بعد دوباره تلاش کنید',
  refreshTokenInvalid: 'نشست شما معتبر نیست. دوباره وارد شوید',
  refreshTokenReused:
    'به دلیل استفاده‌ی مشکوک از نشست، همه‌ی نشست‌های شما بسته شد. دوباره وارد شوید',

  // سازمان و ساختمان (BM-01 §5، §35، §37)
  organizationSlugTaken: 'این شناسه سازمان قبلاً استفاده شده است',
  buildingCodeTaken: 'این کد ساختمان در سازمان شما قبلاً ثبت شده است',
  duplicateBuildingSuspected:
    'ساختمانی با نشانی و مشخصات مشابه از قبل ثبت شده است. برای ثبت دوباره، آن را تأیید کنید',
  buildingNotEditableInStatus:
    'ساختمان در وضعیت فعلی قابل ویرایش نیست',

  // واحد (BM-01 §36)
  unitLabelTaken: 'واحدی با این شماره در این ساختمان وجود دارد',
  unitNotInBuilding: 'این واحد متعلق به ساختمان جاری نیست',

  // مالکیت و سکونت (BM-01 §18، §19، §20)
  ownershipShareExceeded: 'مجموع سهم مالکیت فعال یک واحد نمی‌تواند از ۱۰۰ بیشتر شود',
  ownershipPeriodOverlap:
    'این شخص در این بازه زمانی از قبل مالک این واحد ثبت شده است',
  occupancyPeriodOverlap:
    'برای این واحد در این بازه زمانی سکونت دیگری ثبت شده است',
  occupantRequired: 'برای این نوع سکونت باید شخص ساکن مشخص شود',
  vacantMustHaveNoOccupant: 'برای سکونت «خالی» نباید شخصی ثبت شود',

  // دوره مدیریت (BM-01 §25، §26 — قانون یکم BM-00)
  termOverlapsExisting:
    'بازه این دوره با دوره دیگری از همین ساختمان هم‌پوشانی دارد',
  termAlreadyActive: 'هم‌اکنون یک دوره مدیریت فعال برای این ساختمان وجود دارد',
  termNotSchedulable: 'دوره در وضعیت فعلی قابل فعال‌سازی نیست',
  termAlreadyClosed: 'این دوره پیش‌تر پایان یافته است و قابل تغییر نیست',
  termClosedNotEditable:
    'دوره پایان‌یافته ویرایش نمی‌شود؛ برای تغییر مدیریت، دوره تازه‌ای ثبت کنید',
  termManagerNotMember:
    'مدیر دوره باید از پیش عضو همین ساختمان باشد',
  termTerminationReasonRequired: 'برای خاتمه دادن به دوره، ذکر دلیل الزامی است',
  termCannotStartInPast:
    'تاریخ شروع دوره نمی‌تواند پیش از دوره پایان‌یافته قبلی باشد',
  termWindowAlreadyPassed:
    'بازه این دوره به پایان رسیده است و دیگر قابل فعال‌سازی نیست؛ دوره تازه‌ای ثبت کنید',
  termChainAlreadyLinked: 'این دوره پیش‌تر جانشین دیگری داشته است',

  // عضویت و دعوت‌نامه (BM-01 §33، §34)
  membershipAlreadyExists: 'این شخص با همین نقش از قبل عضو است',
  cannotRemoveLastOrgOwner: 'آخرین مالک سازمان را نمی‌توان حذف کرد',
  invitationInvalid: 'این دعوت‌نامه معتبر نیست',
  invitationExpired: 'مهلت این دعوت‌نامه به پایان رسیده است',
  invitationAlreadyUsed: 'این دعوت‌نامه قبلاً استفاده شده است',
  invitationNotPending: 'این دعوت‌نامه در وضعیت قابل تغییر نیست',
  personProfileRequired:
    'برای این کار باید ابتدا مشخصات فردی خود را تکمیل کنید',
} as const;

/** متن حالت‌های خالی. */
export const EMPTY_STATES = {
  noResults: 'نتیجه‌ای یافت نشد',
  noResultsHint: 'عبارت جست‌وجو یا فیلترها را تغییر دهید',
  noBuildings: 'هنوز ساختمانی ثبت نشده است',
  noBuildingsHint: 'برای شروع، نخستین ساختمان خود را اضافه کنید',
  noUnits: 'هنوز واحدی ثبت نشده است',
  noMembers: 'هنوز عضوی افزوده نشده است',
  noCharges: 'شارژی ثبت نشده است',
  noInvoices: 'صورت‌حسابی صادر نشده است',
  noPayments: 'پرداختی ثبت نشده است',
  noWorkOrders: 'درخواست کاری ثبت نشده است',
  noAnnouncements: 'اطلاعیه‌ای منتشر نشده است',
  noDocuments: 'سندی بارگذاری نشده است',
  noNotifications: 'اعلان جدیدی ندارید',
  errorTitle: 'مشکلی پیش آمد',
  errorHint: 'می‌توانید دوباره تلاش کنید',
} as const;

/** عنوان ستون‌های جدول و برچسب فیلدها. */
export const FIELDS = {
  // شناسه و عمومی
  title: 'عنوان',
  name: 'نام',
  description: 'توضیحات',
  status: 'وضعیت',
  role: 'نقش',
  type: 'نوع',
  actions: 'عملیات',
  createdAt: 'تاریخ ایجاد',
  updatedAt: 'تاریخ به‌روزرسانی',
  notes: 'یادداشت',

  // شخص
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  fullName: 'نام و نام خانوادگی',
  nationalId: 'کد ملی',
  email: 'رایانامه',
  phone: 'تلفن همراه',
  password: 'گذرواژه',
  passwordConfirm: 'تکرار گذرواژه',

  // ساختمان و واحد
  building: 'ساختمان',
  buildingName: 'نام ساختمان',
  organization: 'سازمان',
  unit: 'واحد',
  unitNumber: 'شماره واحد',
  unitKind: 'نوع کاربری',
  floor: 'طبقه',
  block: 'بلوک',
  area: 'متراژ',
  areaSquareMeters: 'متراژ (متر مربع)',
  bedrooms: 'تعداد اتاق خواب',
  parkingCount: 'تعداد پارکینگ',
  storageCount: 'تعداد انباری',
  shareRatio: 'ضریب سهم',
  totalUnits: 'تعداد کل واحدها',
  floors: 'تعداد طبقات',
  buildYear: 'سال ساخت',

  // نشانی
  address: 'نشانی',
  province: 'استان',
  city: 'شهر',
  district: 'محله',
  street: 'خیابان',
  postalCode: 'کد پستی',
  plaque: 'پلاک',
  latitude: 'عرض جغرافیایی',
  longitude: 'طول جغرافیایی',

  // مالکیت و سکونت
  owner: 'مالک',
  tenant: 'مستأجر',
  occupant: 'ساکن',
  ownership: 'مالکیت',
  occupancy: 'سکونت',
  periodStart: 'تاریخ شروع',
  periodEnd: 'تاریخ پایان',
  isPrimary: 'اصلی',

  // دوره مدیریت
  managementTerm: 'دوره مدیریت',
  manager: 'مدیر',
  termStart: 'شروع دوره',
  termEnd: 'پایان دوره',

  // دعوت‌نامه
  invitation: 'دعوت‌نامه',
  invitedBy: 'دعوت‌کننده',
  expiresAt: 'تاریخ انقضا',

  // مالی
  amount: 'مبلغ',
  balance: 'مانده حساب',
  debit: 'بدهکار',
  credit: 'بستانکار',
  dueDate: 'سررسید',
  paidAt: 'تاریخ پرداخت',
  period: 'دوره',
  currency: 'واحد پول',
} as const;

/** متن‌های احراز هویت. */
export const AUTH = {
  loginTitle: 'ورود به سامانه',
  loginSubtitle: 'برای ادامه، اطلاعات حساب خود را وارد کنید',
  loginButton: 'ورود به سامانه',
  logoutButton: 'خروج از حساب',
  registerTitle: 'ایجاد حساب کاربری',
  registerButton: 'ایجاد حساب',
  forgotPassword: 'گذرواژه خود را فراموش کرده‌اید؟',
  rememberMe: 'مرا به خاطر بسپار',
  emailOrPhone: 'رایانامه یا شماره همراه',
  emailPlaceholder: 'نشانی رایانامه خود را وارد کنید',
  phonePlaceholder: '۰۹۱۲۱۲۳۴۵۶۷',
  passwordPlaceholder: 'گذرواژه خود را وارد کنید',
  loggingIn: 'در حال ورود…',
  loginSuccess: 'با موفقیت وارد شدید',
  welcomeBack: 'خوش آمدید',
  noAccount: 'حساب کاربری ندارید؟',
  haveAccount: 'حساب کاربری دارید؟',
} as const;

/** واحدهای پول و اندازه‌گیری. */
export const UNITS = {
  currencyIRR: 'ریال',
  currencyToman: 'تومان',
  squareMeter: 'متر مربع',
  person: 'نفر',
  item: 'مورد',
  day: 'روز',
  month: 'ماه',
  year: 'سال',
} as const;

/** ارقام فارسی — در `VALIDATION` هم استفاده می‌شود، پس همین‌جا تعریف می‌شود. */
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/**
 * تبدیل ارقام لاتین به فارسی در یک رشته یا عدد.
 * فقط رقم‌ها را عوض می‌کند و بقیه‌ی نویسه‌ها را دست‌نخورده می‌گذارد، پس روی
 * متنی که شناسه یا کد انگلیسی دارد هم امن است.
 */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(
    /[0-9]/g,
    (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit,
  );
}

/**
 * تبدیل ارقام فارسی/عربی به لاتین.
 * برای ورودی کاربر ضروری است: کاربر «۱۲۳۴» تایپ می‌کند و `parseInt` روی آن
 * `NaN` می‌دهد. هر فیلد عددی باید ورودی را از این تابع عبور دهد.
 */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[\u06F0-\u06F9]/g, (d) =>
      String(d.charCodeAt(0) - 0x06f0),
    )
    .replace(/[\u0660-\u0669]/g, (d) =>
      String(d.charCodeAt(0) - 0x0660),
    );
}
