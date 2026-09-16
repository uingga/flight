import SharePage, { generateMetadata as generateShareMetadata } from '../../share/[id]/page';

type Props = {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

async function blogProps(props: Props): Promise<Props> {
    return {
        params: props.params,
        searchParams: Promise.resolve({ ...(await props.searchParams), utm_source: 'naver_blog', v: 'blog-mobile-safe-20260917' }),
    };
}

export async function generateMetadata(props: Props) {
    const metadata = await generateShareMetadata(await blogProps(props));
    const { id } = await props.params;
    return { ...metadata, alternates: { canonical: `/blog-share/${id}` } };
}

export default async function BlogSharePage(props: Props) {
    return SharePage(await blogProps(props));
}
