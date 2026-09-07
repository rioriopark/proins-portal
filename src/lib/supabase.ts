import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env 파일을 확인하세요.'
  )
}

export const supabase = createClient(url, anonKey)

// PostgREST는 기본적으로 한 요청당 최대 1000행만 반환한다.
// contracts처럼 테이블이 계속 커지는 경우 select('*')만으로는 일부 행이 조용히 누락되므로,
// 페이지 단위로 전체를 끝까지 가져와야 하는 곳에서 이 헬퍼를 사용한다.
export async function fetchAllRows<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await queryFactory(from, from + pageSize - 1)
    if (error) {
      console.error('fetchAllRows 실패:', error)
      break
    }
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return rows
}
